import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { HubSession } from '@sorye/types';
import { readBoundedFormData, withUploadSlot, UploadLimitError } from '../bounded-upload';
import { createWorkspaceFile, getWorkspaceFile, FileAccessError } from '../files';
import { enqueueJob, hasLiveWorker, JobWorkerUnavailableError, QueueFullError } from '../jobs';
import { MAX_OCR_PDF_BYTES } from '../security-limits';

export async function submitOcr(req: Request, session: HubSession) {
  try {
    return await withUploadSlot(async () => {
      if (!(await hasLiveWorker('ocr'))) throw new JobWorkerUnavailableError('OCR processing is temporarily unavailable. Please retry shortly.');
      const form = await readBoundedFormData(req, MAX_OCR_PDF_BYTES + 1_000_000);
      let fileId = form.get('fileId');
      if (typeof fileId !== 'string') {
        const file = form.get('file');
        if (!(file instanceof File) || file.size > MAX_OCR_PDF_BYTES) throw new UploadLimitError('Choose a PDF within the upload limit', 413);
        const bytes = Buffer.from(await file.arrayBuffer());
        if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new UploadLimitError('Only PDF files can be analyzed', 400);
        const saved = await createWorkspaceFile({ workspaceId: session.workspace.id, sourceAppId: 'ocr', displayName: file.name, bytes });
        fileId = saved.id;
      }
      const file = await getWorkspaceFile(session.workspace.id, String(fileId));
      if (file.mime !== 'application/pdf') throw new UploadLimitError('Only PDF files can be analyzed', 400);
      const key = req.headers.get('idempotency-key') ?? file.id;
      if (key.length > 128 || !key.trim()) throw new UploadLimitError('Invalid idempotency key', 400);
      const job = await enqueueJob({ workspaceId: session.workspace.id, userId: session.user.id,
        kind: 'ocr', key, payload: { fileId: file.id, analysisId: `ocr-${randomUUID()}` } });
      return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
    });
  } catch (err) {
    const status = err instanceof QueueFullError ? 429 : err instanceof UploadLimitError || err instanceof FileAccessError ? err.status : 503;
    const message = err instanceof JobWorkerUnavailableError ? err.message : status === 503 ? 'Could not queue analysis. Please retry.' : (err as Error).message;
    return NextResponse.json({ error: message },
      { status, headers: { 'Retry-After': '10' } });
  }
}
