import type { OcrAnalysis, OcrAnalysisStatus } from '@sorye/types';
import { updateOcrAnalysis } from '@/lib/store/ocr-analyses';
import { withGpuFinish, withGpuStart } from './vector';

/** Persist the first model-request timestamp. Later calls keep the original start. */
export async function persistGpuStart(
  userId: string,
  workspaceId: string,
  analysis: OcrAnalysis,
  startedAt: string,
): Promise<OcrAnalysis> {
  if (analysis.vector.gpuStartedAt) return analysis;
  const vector = withGpuStart(analysis.vector, startedAt);
  const next = { ...analysis, vector };
  await updateOcrAnalysis(userId, workspaceId, analysis.id, {
    status: next.status,
    pattern: next.pattern,
    error: next.error,
    vector,
  });
  return next;
}

/** Stamp the finish time only after model work has left the extracting state. */
export function finishGpuClock(analysis: OcrAnalysis, status: OcrAnalysisStatus): OcrAnalysis {
  if (status === 'extracting') return analysis;
  const vector = withGpuFinish(analysis.vector);
  if (vector === analysis.vector) return analysis;
  return { ...analysis, vector };
}
