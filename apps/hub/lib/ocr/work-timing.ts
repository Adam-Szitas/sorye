import type { OcrAnalysis } from '@sorye/types';

const MAX_DURATION_MS = 2_147_483_647;

function validIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

/**
 * Copy the vector GPU clock onto the analysis row.
 * The span matches the clock stored for the reading UI.
 * Batch duration is kept only when that clock has no end yet.
 */
export function stampWorkColumns(row: OcrAnalysis): OcrAnalysis {
  const started = validIso(row.vector?.gpuStartedAt) ?? validIso(row.workStartedAt);
  const terminal = row.status === 'ready' || row.status === 'rows_only';
  let finished = validIso(row.vector?.gpuFinishedAt) ?? validIso(row.workFinishedAt);
  if (!terminal) finished = validIso(row.workFinishedAt);
  if (terminal && started && !finished) finished = new Date().toISOString();

  let durationMs = row.durationMs ?? null;
  if (typeof durationMs === 'number' && (!Number.isFinite(durationMs) || durationMs < 0)) {
    durationMs = null;
  }
  if (started && finished) {
    const span = Date.parse(finished) - Date.parse(started);
    if (Number.isFinite(span) && span >= 0) {
      durationMs = Math.min(MAX_DURATION_MS, Math.round(span));
    }
  } else if (durationMs != null) {
    durationMs = Math.min(MAX_DURATION_MS, Math.round(durationMs));
  }

  return {
    ...row,
    workStartedAt: started,
    workFinishedAt: finished,
    durationMs,
  };
}

export function accumulatedDuration(
  savedMs: number | null | undefined,
  batchMs: number | undefined,
): number | undefined {
  if (batchMs == null || !Number.isFinite(batchMs)) {
    return savedMs == null ? undefined : savedMs;
  }
  const next = (savedMs ?? 0) + Math.max(0, Math.round(batchMs));
  return Math.min(MAX_DURATION_MS, next);
}
