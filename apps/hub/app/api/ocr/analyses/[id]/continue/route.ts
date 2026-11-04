import { ensureHubUser } from '@/lib/ensure-user';
import { acquireOcrSlot } from '@/lib/ocr/admission';
import { analyzeRowPages } from '@/lib/ocr/analyze';
import { releaseLoadedModel } from '@/lib/ocr/llm';
import { finishGpuClock, persistGpuStart } from '@/lib/ocr/gpu-time';
import { storeOcrBatch } from '@/lib/ocr/store-batch';
import { getOcrAnalysis } from '@/lib/store/ocr-analyses';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!/^ocr-[a-zA-Z0-9-]{4,40}$/.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const loaded = await getOcrAnalysis(session.user.id, session.workspace.id, id);
  if (loaded.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!loaded.analysis) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (loaded.analysis.status !== 'extracting') {
    return NextResponse.json({ analysis: loaded.analysis }, { headers });
  }

  const release = acquireOcrSlot();
  if (!release) {
    return NextResponse.json(
      { error: 'OCR is processing another document. Please retry in a few seconds.' },
      { status: 429, headers: { ...headers, 'Retry-After': '2' } },
    );
  }

  const hold = { model: false };
  try {
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(240_000)]);
    const cursor = loaded.analysis.vector.cursor;
    let analysis = loaded.analysis;
    const reading = await analyzeRowPages(analysis.pages, signal, {
      start: cursor?.next ?? 0,
      missed: cursor?.missed ?? 0,
      prior: analysis.pattern,
      onModelStart: async (startedAt) => {
        analysis = await persistGpuStart(session.user.id, session.workspace.id, analysis, startedAt);
      },
    });
    const finished = await storeOcrBatch(
      session.user.id,
      session.workspace.id,
      finishGpuClock(analysis, reading.status),
      reading,
    );
    hold.model = finished.status === 'extracting';
    return NextResponse.json({ analysis: finished }, { headers });
  } finally {
    if (!hold.model) await releaseLoadedModel();
    release();
  }
}
