import type { OcrAnalysis } from '@sorye/types';
import { assertJsonPayloadSize, MAX_OCR_ANALYSIS_BYTES } from '@/lib/security-limits';
import { updateOcrAnalysis } from '@/lib/store/ocr-analyses';
import type { OcrLlmResult } from './analyze';
import { accumulatedDuration, stampWorkColumns } from './work-timing';
import { withCursor } from './vector';

/** Write one slice of model progress onto the row that already holds the transcript. */
export async function storeOcrBatch(
  userId: string,
  workspaceId: string,
  saved: OcrAnalysis,
  reading: OcrLlmResult,
): Promise<OcrAnalysis> {
  const vector = withCursor(saved.vector, reading.cursor);
  const durationMs = accumulatedDuration(saved.durationMs, reading.durationMs);
  const timed = stampWorkColumns({
    ...saved,
    vector,
    status: reading.status,
    durationMs: durationMs ?? saved.durationMs ?? null,
  });
  try {
    assertJsonPayloadSize(
      { pages: saved.pages, vector, pattern: reading.pattern },
      MAX_OCR_ANALYSIS_BYTES,
      'OCR analysis',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pattern JSON exceeds the storage size limit.';
    const kept = await updateOcrAnalysis(userId, workspaceId, saved.id, {
      status: 'rows_only',
      pattern: saved.pattern,
      error: `${message} Rows were kept.`,
      vector: withCursor(saved.vector, null),
      ...(durationMs == null ? {} : { durationMs }),
    });
    return kept ?? { ...saved, status: 'rows_only', error: message, ...(durationMs == null ? {} : { durationMs }) };
  }

  const finished = await updateOcrAnalysis(userId, workspaceId, saved.id, {
    status: reading.status,
    pattern: reading.pattern,
    error: reading.error,
    vector: timed.vector,
    workStartedAt: timed.workStartedAt,
    workFinishedAt: timed.workFinishedAt,
    durationMs: timed.durationMs,
  });
  if (!finished) {
    return { ...timed, status: reading.status, pattern: reading.pattern, error: reading.error };
  }
  return finished;
}
