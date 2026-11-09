import type { OcrAnalysis } from '@sorye/types';
import { finishGpuClock, persistGpuStart } from './gpu-time';
import { normalizePattern, supplementFromRows } from './pattern';
import { storeOcrBatch } from './store-batch';
import { completenessWarning } from './vector';

export interface ClientWebGpuPatternInput {
  model?: string;
  startedAt?: string;
  durationMs?: number;
  pattern: unknown;
}

function sanitizeClientRecords(value: unknown): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  const out: Array<Record<string, string>> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec: Record<string, string> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) {
        rec[k.slice(0, 80)] = v.trim().slice(0, 2000);
      }
    }
    if (Object.keys(rec).length > 0) out.push(rec);
    if (out.length >= 2000) break;
  }
  return out;
}

function sanitizeClientFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) {
      out[k.slice(0, 80)] = v.trim().slice(0, 2000);
    }
    if (Object.keys(out).length >= 200) break;
  }
  return out;
}

/**
 * Validate, align, and persist a pattern extracted on the user's browser WebGPU.
 * Source `pages` and `lines` are never overwritten by client input, and every
 * record is aligned to the stored Node.js rows via `supplementFromRows`.
 */
export async function applyClientWebGpuPattern(
  userId: string,
  workspaceId: string,
  analysis: OcrAnalysis,
  input: ClientWebGpuPatternInput,
): Promise<OcrAnalysis> {
  const startedAt =
    typeof input.startedAt === 'string' && !Number.isNaN(Date.parse(input.startedAt))
      ? input.startedAt
      : new Date().toISOString();
  const withStart = await persistGpuStart(userId, workspaceId, analysis, startedAt);

  const rawObj =
    input.pattern && typeof input.pattern === 'object' && !Array.isArray(input.pattern)
      ? (input.pattern as Record<string, unknown>)
      : {};
  const normalized = normalizePattern(input.pattern);
  const clientRecords = sanitizeClientRecords(rawObj.records);
  const clientFields = sanitizeClientFields(rawObj.fields);
  const supplemented = supplementFromRows(
    {
      ...normalized,
      records: clientRecords.length > 0 ? clientRecords : normalized.records,
      fields: Object.keys(clientFields).length > 0 ? clientFields : normalized.fields,
    },
    analysis.pages,
  );
  const summaryPrefix =
    supplemented.summary?.trim() ||
    `Normalized ${supplemented.normalizedRows?.length ?? 0} rows on client WebGPU.`;
  const summarySuffix = `All ${analysis.pages.length} pages were read.`;
  const summary = summaryPrefix.includes(summarySuffix)
    ? summaryPrefix
    : `${summaryPrefix} ${summarySuffix}`.trim();

  const warning = completenessWarning(withStart.vector);
  const status = warning ? ('rows_only' as const) : ('ready' as const);
  const durationMs =
    typeof input.durationMs === 'number' &&
    Number.isFinite(input.durationMs) &&
    input.durationMs > 0
      ? Math.min(Math.round(input.durationMs), 3_600_000)
      : 1;

  const model =
    typeof input.model === 'string' && input.model.trim()
      ? input.model.trim().slice(0, 80)
      : 'webgpu:Qwen2.5-3B-Instruct-q4f16_1-MLC';

  return storeOcrBatch(
    userId,
    workspaceId,
    finishGpuClock({ ...withStart, model }, status),
    {
      model,
      status,
      pattern: {
        ...supplemented,
        summary: summary.slice(0, 600),
      },
      error: warning,
      cursor: { next: 1, total: 1, missed: 0 },
      durationMs,
    },
  );
}
