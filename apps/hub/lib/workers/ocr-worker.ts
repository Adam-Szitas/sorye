import type { OcrAnalysis } from '@sorye/types';
import { randomUUID } from 'node:crypto';
import { getWorkspaceFile, readWorkspaceFileBytes } from '@/lib/files';
import { finishJob, getJob, heartbeatJob, retryJob, claimJob, setWorkerHeartbeat, updateJobProgress, type Job } from '@/lib/jobs';
import { llmModelName, releaseLoadedModel } from '@/lib/ocr/llm';
import { analyzeRowPages } from '@/lib/ocr/analyze';
import { readPdfAsRows } from '@/lib/ocr/read-pdf';
import { buildVector, completenessWarning } from '@/lib/ocr/vector';
import { storeOcrBatch } from '@/lib/ocr/store-batch';
import { MAX_OCR_ANALYSIS_BYTES, MAX_OCR_PAGES, MAX_OCR_PDF_BYTES, assertJsonPayloadSize } from '@/lib/security-limits';
import { createOcrAnalysis, getOcrAnalysis, updateOcrAnalysis } from '@/lib/store/ocr-analyses';

const POLL_MS = 750;
const HEARTBEAT_MS = 20_000;
const WORKER_ID = `worker:ocr:${randomUUID()}`;
const SHUTDOWN = new AbortController();
process.once('SIGTERM', () => SHUTDOWN.abort(new Error('Worker shutting down')));
process.once('SIGINT', () => SHUTDOWN.abort(new Error('Worker shutting down')));

function payloadString(job: Job, key: string): string {
  const value = job.payload[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new Error('Job payload is invalid');
  }
  return value;
}

function safeFileName(name: string): string {
  const cleaned = name.split(/[/\\]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
  return cleaned || 'document.pdf';
}

async function runOcr(job: Job, signal: AbortSignal): Promise<Record<string, unknown>> {
  const fileId = payloadString(job, 'fileId');
  const analysisId = payloadString(job, 'analysisId');
  const existing = await getOcrAnalysis(job.userId, job.workspaceId, analysisId);
  if (existing.access === 'denied') throw new Error('Workspace access was revoked');
  let analysis: OcrAnalysis | null = existing.analysis;

  if (!analysis) {
    await updateJobProgress(job, { phase: 'reading_pdf', analysisId });
    const file = await getWorkspaceFile(job.workspaceId, fileId);
    if (file.mime !== 'application/pdf' || file.size > MAX_OCR_PDF_BYTES) throw new Error('The saved file is not an allowed PDF');
    const loaded = await readWorkspaceFileBytes(job.workspaceId, fileId);
    signal.throwIfAborted();
    const bytes = new Uint8Array(loaded.bytes);
    if (bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('The saved file is not a readable PDF');
    const pages = await readPdfAsRows(bytes, signal);
    if (pages.length > MAX_OCR_PAGES) throw new Error(`PDF has too many pages (max ${MAX_OCR_PAGES})`);
    const vector = buildVector(pages);
    assertJsonPayloadSize({ pages, vector }, MAX_OCR_ANALYSIS_BYTES, 'OCR transcript');
    let model = 'none';
    try { model = llmModelName(); } catch { /* Extracted rows remain useful without a model. */ }
    analysis = await createOcrAnalysis(job.userId, job.workspaceId, {
      id: analysisId,
      fileName: safeFileName(file.displayName),
      model,
      status: 'extracting',
      pages,
      pattern: null,
      error: completenessWarning(vector),
      vector,
    });
    if (!analysis) throw new Error('Workspace access was revoked');
  }

  while (analysis.status === 'extracting') {
    signal.throwIfAborted();
    const cursor = analysis.vector?.cursor;
    await updateJobProgress(job, {
      phase: 'analyzing', analysisId,
      completed: cursor?.next ?? 0, total: cursor?.total ?? 0,
    });
    const reading = await analyzeRowPages(analysis.pages, signal, {
      start: cursor?.next ?? 0,
      missed: cursor?.missed ?? 0,
      prior: analysis.pattern,
    });
    signal.throwIfAborted();
    analysis = await storeOcrBatch(job.userId, job.workspaceId, analysis, reading);
  }
  return { analysisId, phase: 'complete' };
}

async function runJob(job: Job): Promise<void> {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, SHUTDOWN.signal]);
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    void getJob(job.workspaceId, job.id).then(async (current) => {
      if (!current || current.status === 'cancelled') {
        controller.abort(new Error('Job cancelled'));
        return;
      }
      const active = current.status === 'running' && current.leaseOwner === job.leaseOwner && await heartbeatJob(job);
      if (!active) controller.abort(new Error('Job lease lost'));
    }).catch(() => controller.abort(new Error('Job lease could not be renewed')))
      .finally(() => { heartbeatBusy = false; });
  }, HEARTBEAT_MS);

  try {
    if (job.kind !== 'ocr') throw new Error('Unsupported job type');
    const result = await runOcr(job, signal);
    signal.throwIfAborted();
    if (!(await finishJob(job, result))) controller.abort(new Error('Job lease lost before completion'));
  } catch (err) {
    const analysisId = typeof job.payload.analysisId === 'string' ? job.payload.analysisId : null;
    if (signal.aborted && controller.signal.aborted && /cancelled/i.test(controller.signal.reason?.message ?? '') && analysisId) {
      const saved = await getOcrAnalysis(job.userId, job.workspaceId, analysisId).catch(() => null);
      if (saved?.access === 'ok' && saved.analysis) await updateOcrAnalysis(job.userId, job.workspaceId, analysisId, {
        status: 'rows_only', pattern: saved.analysis.pattern,
        error: 'Analysis was cancelled. Extracted rows, if available, are retained.',
      }).catch(() => undefined);
    }
    if (SHUTDOWN.signal.aborted) await retryJob(job).catch(() => undefined);
    else if (signal.aborted && controller.signal.aborted) {
      // Cancellation or lost lease is terminal only when the row is still owned by this worker.
      await retryJob(job).catch(() => undefined);
    } else {
      console.error('[ocr-worker] job failed', job.id, err instanceof Error ? err.message : 'unknown error');
      await retryJob(job).catch((retryError) => console.error('[ocr-worker] retry update failed', retryError));
    }
  } finally {
    clearInterval(heartbeat);
    await releaseLoadedModel().catch(() => undefined);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.info('[ocr-worker] started');
  await setWorkerHeartbeat(WORKER_ID, true);
  const workerHeartbeat = setInterval(() => {
    void setWorkerHeartbeat(WORKER_ID, true).catch((err) => {
      console.error('[ocr-worker] heartbeat failed', err instanceof Error ? err.message : 'unknown error');
    });
  }, 10_000);
  try {
    while (!SHUTDOWN.signal.aborted) {
      try {
        const job = await claimJob('ocr');
        if (job) await runJob(job);
        else await sleep(POLL_MS);
      } catch (err) {
        console.error('[ocr-worker] poll failed', err instanceof Error ? err.message : 'unknown error');
        await sleep(Math.min(POLL_MS * 4, 5_000));
      }
    }
  } finally {
    clearInterval(workerHeartbeat);
    await setWorkerHeartbeat(WORKER_ID, false).catch(() => undefined);
  }
  console.info('[ocr-worker] stopped');
}

void main().catch((err: unknown) => {
  console.error('[ocr-worker] fatal startup error', err);
  process.exitCode = 1;
});
