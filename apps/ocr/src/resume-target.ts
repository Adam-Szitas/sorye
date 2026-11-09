/** What OCR should show when it mounts or a Hub open-app target arrives. */

export interface OcrResumeJob {
  id: string;
  status: string;
  error?: string | null;
  analysisId?: string | null;
  presented?: boolean;
}

export interface OcrLaunchTarget {
  analysisId?: string;
  jobId?: string;
  outcome?: 'success' | 'failure';
}

export type OcrResumeChoice =
  | { action: 'none' }
  | { action: 'poll'; jobId: string }
  | { action: 'show'; analysisId: string; jobId?: string }
  | { action: 'error'; message: string; analysisId?: string; jobId?: string };

export function readStoredLaunch(raw: string | null): OcrLaunchTarget | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const analysisId = typeof record.analysisId === 'string' && record.analysisId ? record.analysisId : undefined;
    const jobId = typeof record.jobId === 'string' && record.jobId ? record.jobId : undefined;
    const outcome = record.outcome === 'success' || record.outcome === 'failure' ? record.outcome : undefined;
    if (!analysisId && !jobId && !outcome) return null;
    return { analysisId, jobId, outcome };
  } catch {
    return null;
  }
}

export function chooseFromJob(job: OcrResumeJob | null | undefined): OcrResumeChoice {
  if (!job?.id) return { action: 'none' };
  if (job.status === 'queued' || job.status === 'running') return { action: 'poll', jobId: job.id };
  if (job.presented) return { action: 'none' };
  if (job.status === 'completed' && job.analysisId) {
    return { action: 'show', analysisId: job.analysisId, jobId: job.id };
  }
  if (job.status === 'failed' || job.status === 'cancelled') {
    return {
      action: 'error',
      message: job.error?.trim() || (job.status === 'cancelled' ? 'Analysis was cancelled.' : 'The OCR run failed.'),
      analysisId: job.analysisId || undefined,
      jobId: job.id,
    };
  }
  return { action: 'none' };
}

/** Launch target from a notification click wins. Otherwise use the latest server job. */
export function chooseOcrResume(input: {
  launch?: OcrLaunchTarget | null;
  job?: OcrResumeJob | null;
}): OcrResumeChoice {
  const launch = input.launch;
  if (launch?.outcome === 'failure') {
    return {
      action: 'error',
      message: input.job?.error?.trim() || 'The OCR run failed.',
      analysisId: launch.analysisId || input.job?.analysisId || undefined,
      jobId: launch.jobId || input.job?.id,
    };
  }
  if (launch?.analysisId) {
    return { action: 'show', analysisId: launch.analysisId, jobId: launch.jobId };
  }
  if (launch?.jobId && (!input.job || input.job.status === 'queued' || input.job.status === 'running')) {
    return { action: 'poll', jobId: launch.jobId };
  }
  return chooseFromJob(input.job);
}
