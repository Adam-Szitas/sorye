/** Pure "job reached a terminal state" notice. OCR is the only kind that notifies. */

export interface FinishedBackgroundJob {
  id: string;
  workspaceId: string;
  userId: string;
  kind: string;
  status: 'completed' | 'failed';
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface OcrJobNotice {
  workspaceId: string;
  userId: string;
  appId: 'ocr';
  title: string;
  body: string;
  jobId: string;
  analysisId?: string;
  outcome: 'success' | 'failure';
}

function boundedId(source: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = source?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return undefined;
  return trimmed;
}

export function analysisIdFromJob(job: {
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
}): string | undefined {
  return boundedId(job.result, 'analysisId') ?? boundedId(job.payload, 'analysisId');
}

function shortText(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || fallback).slice(0, 180);
}

/**
 * Notification for a finished background job.
 * Relay and other kinds share the completion hook and return null here.
 */
export function buildOcrJobNotification(job: FinishedBackgroundJob): OcrJobNotice | null {
  if (job.kind !== 'ocr') return null;
  if (!job.workspaceId || job.workspaceId === '@system' || !job.userId || !job.id) return null;
  const analysisId = analysisIdFromJob(job);
  if (job.status === 'completed') {
    return {
      workspaceId: job.workspaceId,
      userId: job.userId,
      appId: 'ocr',
      title: 'OCR finished',
      body: 'The document reading is ready.',
      jobId: job.id,
      analysisId,
      outcome: 'success',
    };
  }
  if (job.status !== 'failed') return null;
  return {
    workspaceId: job.workspaceId,
    userId: job.userId,
    appId: 'ocr',
    title: 'OCR run failed',
    body: shortText(job.error, 'The OCR run failed.'),
    jobId: job.id,
    analysisId,
    outcome: 'failure',
  };
}
