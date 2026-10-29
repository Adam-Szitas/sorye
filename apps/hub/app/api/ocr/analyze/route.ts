import { readBoundedFormData, UploadLimitError } from '@/lib/bounded-upload';
import { ensureHubUser } from '@/lib/ensure-user';
import { createWorkspaceFile, readWorkspaceFileBytes, FileAccessError } from '@/lib/files';
import { analyzeRowPages } from '@/lib/ocr/analyze';
import { storeOcrBatch } from '@/lib/ocr/store-batch';
import { acquireOcrSlot } from '@/lib/ocr/admission';
import { assertOcrAnalyzeRateLimit } from '@/lib/ocr/rate-limit';
import { llmModelName, releaseLoadedModel } from '@/lib/ocr/llm';
import { readPdfAsRows } from '@/lib/ocr/read-pdf';
import { buildVector, completenessWarning } from '@/lib/ocr/vector';
import {
  assertJsonPayloadSize,
  MAX_OCR_ANALYSIS_BYTES,
  MAX_OCR_PAGES,
  MAX_OCR_PDF_BYTES,
} from '@/lib/security-limits';
import { createOcrAnalysis } from '@/lib/store/ocr-analyses';
import { NextResponse } from 'next/server';
import { getStoreDriver } from '@/lib/env';
import { submitOcr } from '@/lib/ocr/submit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'document.pdf';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
  return cleaned || 'document.pdf';
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (getStoreDriver() === 'postgres') return submitOcr(req, session);
  try {
    assertOcrAnalyzeRateLimit(session.workspace.id, session.user.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Too many requests' },
      { status: 429 },
    );
  }

  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_OCR_PDF_BYTES + 1_000_000) {
    return NextResponse.json({ error: 'Upload is too large' }, { status: 413 });
  }

  const release = acquireOcrSlot();
  if (!release) {
    return NextResponse.json(
      { error: 'OCR is processing another document. Please retry in a few seconds.' },
      { status: 429, headers: { 'Retry-After': '3', 'Cache-Control': 'no-store' } },
    );
  }
  const hold = { model: false };
  try {
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(240_000)]);
    return await analyzeUpload(req, session, signal, hold);
  } finally {
    if (!hold.model) await releaseLoadedModel();
    release();
  }
}

async function analyzeUpload(
  req: Request,
  session: NonNullable<Awaited<ReturnType<typeof ensureHubUser>>>,
  signal: AbortSignal,
  hold: { model: boolean },
) {
  let form: FormData;
  try {
    form = await readBoundedFormData(req, MAX_OCR_PDF_BYTES + 1_000_000);
  } catch (err) {
    if (err instanceof UploadLimitError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: 'Expected a PDF upload' }, { status: 400 });
  }

  let upload = form.get('file');
  const fileId = form.get('fileId');
  if (typeof fileId === 'string') {
    try {
      const stored = await readWorkspaceFileBytes(session.workspace.id, fileId);
      upload = new File([new Uint8Array(stored.bytes)], stored.file.displayName, { type: stored.file.mime });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not read file' },
        { status: err instanceof FileAccessError ? err.status : 500 });
    }
  }
  if (!(upload instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (upload.size > MAX_OCR_PDF_BYTES) {
    return NextResponse.json(
      {
        error: `PDF is too large (max ${Math.floor(MAX_OCR_PDF_BYTES / (1024 * 1024))} MB)`,
      },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await upload.arrayBuffer());
  if (bytes.byteLength > MAX_OCR_PDF_BYTES) {
    return NextResponse.json({ error: 'PDF is too large' }, { status: 400 });
  }
  if (!isPdf(bytes)) {
    return NextResponse.json({ error: 'Only PDF files can be analyzed' }, { status: 400 });
  }

  if (typeof fileId !== 'string') {
    try {
      await createWorkspaceFile({ workspaceId: session.workspace.id, displayName: upload.name,
        bytes: Buffer.from(bytes), sourceAppId: 'ocr' });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save PDF to Drive' },
        { status: err instanceof FileAccessError ? err.status : 500 });
    }
  }

  let pages;
  try {
    pages = await readPdfAsRows(bytes);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not read this PDF' },
      { status: 400 },
    );
  }

  if (pages.length > MAX_OCR_PAGES) {
    return NextResponse.json(
      { error: `PDF has too many pages (max ${MAX_OCR_PAGES})` },
      { status: 400 },
    );
  }

  const vector = buildVector(pages);
  try {
    assertJsonPayloadSize({ pages, vector }, MAX_OCR_ANALYSIS_BYTES, 'OCR transcript');
  } catch {
    return NextResponse.json(
      { error: 'OCR transcript exceeds the storage size limit; no analysis was saved.' },
      { status: 413 },
    );
  }

  let model = 'none';
  try {
    model = llmModelName();
  } catch {
    model = 'none';
  }

  let saved;
  try {
    saved = await createOcrAnalysis(session.user.id, session.workspace.id, {
      fileName: safeFileName(upload.name),
      model,
      status: 'extracting',
      pages,
      pattern: null,
      error: completenessWarning(vector),
      vector,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not store the analysis';
    console.error('[ocr] store', message);
    return NextResponse.json({ error: 'Could not store the analysis' }, { status: 500 });
  }
  if (!saved) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const reading = await analyzeRowPages(pages, signal, { prior: null });
  const finished = await storeOcrBatch(
    session.user.id,
    session.workspace.id,
    saved,
    reading,
  );
  hold.model = finished.status === 'extracting';

  return NextResponse.json(
    { analysis: finished },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
