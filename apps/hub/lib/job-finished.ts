import { noteFinishedOperatorJob } from '@/lib/operator/sink';
import { recordWorkspaceNotification } from '@/lib/notifications';
import { getOcrAnalysis, updateOcrAnalysis } from '@/lib/store/ocr-analyses';
import { buildOcrJobNotification, type FinishedBackgroundJob } from '@/lib/job-finished-notice';

export type { FinishedBackgroundJob } from '@/lib/job-finished-notice';

/**
 * Shared completion hook for background jobs. OCR records a workspace notice
 * for the user who started the job. Other kinds, including Relay, no-op.
 */
export async function notifyFinishedBackgroundJob(job: FinishedBackgroundJob): Promise<void> {
  noteFinishedOperatorJob(job);
  const notice = buildOcrJobNotification(job);
  if (!notice) return;
  await recordWorkspaceNotification(notice);
  if (notice.outcome !== 'failure' || !notice.analysisId) return;
  try {
    const existing = await getOcrAnalysis(job.userId, job.workspaceId, notice.analysisId);
    if (existing.access !== 'ok' || !existing.analysis || existing.analysis.status !== 'extracting') return;
    await updateOcrAnalysis(job.userId, job.workspaceId, notice.analysisId, {
      status: 'rows_only',
      pattern: existing.analysis.pattern,
      error: notice.body,
    });
  } catch (err) {
    console.error('[jobs] could not store OCR failure', err instanceof Error ? err.message : 'unknown error');
  }
}
