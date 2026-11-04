import type { OcrAiPage, OcrAnalysisStatus, OcrPatternDocument } from '@sorye/types';
import { completeJson, llmModelName, assertLlmAvailable, LlmUnavailableError } from './llm';
import { assertGpuHeadroom, GpuCapacityError } from './gpu-guard';
import { chunkRowPages, outputTokenCap, splitChunk } from './chunks';
import { buildVector, completenessWarning } from './vector';
import { getLlmControlSettings } from '../llm-control';
import {
  emptyPattern,
  mergePatterns,
  normalizePattern,
  supplementFromRows,
  OCR_NORMALIZATION_VERSION,
} from './pattern';

/**
 * Short documents finish in one request. Longer ones pause so the browser
 * can show progress and the HTTP call stays inside its time limit.
 */
export function ocrBatchBudgetMs(slicesRemaining: number): number {
  return slicesRemaining <= 8 ? 210_000 : 70_000;
}

export interface OcrCursor {
  next: number;
  total: number;
  missed: number;
}

export interface OcrLlmResult {
  model: string;
  status: OcrAnalysisStatus;
  pattern: OcrPatternDocument;
  error: string | null;
  cursor: OcrCursor;
  /** Time spent in the model loop for this batch. Omitted when inference never started. */
  durationMs?: number;
}

function hasInk(pages: OcrAiPage[]): boolean {
  return pages.some((page) => page.rows.length > 0);
}

function isOutputLimit(err: unknown): boolean {
  return err instanceof Error && /output limit/i.test(err.message);
}

function isCancelled(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && /cancelled|time budget/i.test(err.message);
}

/**
 * A slice that hits the output limit is halved and read again.
 * The document is not failed because one reply was too long.
 */
function sliceRows(text: string): number {
  return text.split('\n').filter((line) => /^\d+\|/.test(line)).length || 1;
}

async function readSlice(
  text: string,
  signal: AbortSignal | undefined,
  depth: number,
  fitted: boolean,
  onModelStart?: () => Promise<void>,
): Promise<OcrPatternDocument> {
  try {
    // Recheck before each inference call because other workloads can consume
    // VRAM while this document is being processed.
    await assertGpuHeadroom();
    if (onModelStart) await onModelStart();
    const maxOutputTokens = fitted ? outputTokenCap(Buffer.byteLength(text), sliceRows(text)) : undefined;
    return normalizePattern(await completeJson(text, signal, { maxOutputTokens, skipProbe: true }));
  } catch (err) {
    if (!isOutputLimit(err)) throw err;
    const halves = splitChunk(text);
    if (!halves || depth >= 6) return emptyPattern();
    const left = await readSlice(halves[0], signal, depth + 1, fitted, onModelStart);
    const right = await readSlice(halves[1], signal, depth + 1, fitted, onModelStart);
    return mergePatterns([left, right]);
  }
}

async function readSliceWithRetry(
  text: string,
  signal: AbortSignal | undefined,
  attempts: number,
  fitted: boolean,
  onModelStart?: () => Promise<void>,
): Promise<OcrPatternDocument> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await readSlice(text, signal, 0, fitted, onModelStart);
    } catch (err) {
      if (isCancelled(err, signal) || err instanceof LlmUnavailableError || err instanceof GpuCapacityError) throw err;
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error('Qwen did not return a pattern.');
}

export interface AnalyzeOptions {
  start?: number;
  budgetMs?: number;
  prior?: OcrPatternDocument | null;
  missed?: number;
  /** Fires once, immediately before the first model request in this call. */
  onModelStart?: (startedAt: string) => void | Promise<void>;
}

/**
 * Read Qwen slices in order. One request covers a time budget; the cursor
 * says where the next request continues. Rows are never discarded.
 */
export async function analyzeRowPages(
  pages: OcrAiPage[],
  signal?: AbortSignal,
  options: AnalyzeOptions = {},
): Promise<OcrLlmResult> {
  // Chunk boundaries change with prompt/input revisions. Never resume an old
  // cursor against a different chunk list, which would silently skip data.
  if (options.prior && options.prior.normalizationVersion !== OCR_NORMALIZATION_VERSION) {
    options = { ...options, start: 0, missed: 0, prior: null };
  }
  let model = 'none';
  try {
    model = llmModelName();
    if (getLlmControlSettings().paused) {
      return {
        model, status: 'rows_only',
        pattern: supplementFromRows(options.prior ?? emptyPattern(), pages),
        error: 'LLM inference is paused by a platform administrator. Extracted rows are retained.',
        cursor: { next: options.start ?? 0, total: chunkRowPages(pages).length, missed: options.missed ?? 0 },
      };
    }
    if (hasInk(pages)) {
      await assertLlmAvailable(signal);
      await assertGpuHeadroom();
    }
  } catch (err) {
    return {
      model,
      status: 'rows_only',
      pattern: supplementFromRows(options.prior ?? emptyPattern(), pages),
      error: err instanceof Error ? err.message : 'OCR LLM is not configured.',
      cursor: { next: 0, total: 0, missed: 0 },
    };
  }

  const note = completenessWarning(buildVector(pages));
  if (!hasInk(pages)) {
    return {
      model,
      status: note ? 'rows_only' : 'ready',
      pattern: {
        ...supplementFromRows(emptyPattern(), pages),
        summary: 'No text or figures were found in this PDF.',
      },
      error: note,
      cursor: { next: 0, total: 0, missed: 0 },
    };
  }

  const chunks = chunkRowPages(pages);
  const start = Math.max(0, Math.min(options.start ?? 0, chunks.length));
  const budgetMs = options.budgetMs ?? ocrBatchBudgetMs(chunks.length - start);
  // One fitting transcript is a single completion: no extra retries, and a
  // pattern-sized output cap. Longer jobs keep the slice retry and the
  // configured output limit so a truncated reply can still be split.
  const started = Date.now();
  const parts: OcrPatternDocument[] = options.prior ? [options.prior] : [];
  let missed = options.missed ?? 0;
  let index = start;
  let announced = false;
  const announceModel = async () => {
    if (announced) return;
    announced = true;
    await options.onModelStart?.(new Date().toISOString());
  };

  while (index < chunks.length) {
    if (index > start && Date.now() - started >= budgetMs) break;
    if (signal?.aborted) break;
    try {
      const fitted = chunks.length === 1;
      parts.push(await readSliceWithRetry(chunks[index]!, signal, fitted ? 1 : 3, fitted, announceModel));
      index += 1;
    } catch (err) {
      if (err instanceof LlmUnavailableError || err instanceof GpuCapacityError) {
        return {
          model, status: 'rows_only',
          pattern: supplementFromRows(parts.length ? mergePatterns(parts) : emptyPattern(), pages),
          error: err.message,
          cursor: { next: index, total: chunks.length, missed },
          durationMs: Date.now() - started,
        };
      }
      if (isCancelled(err, signal)) break;
      missed += 1;
      index += 1;
    }
  }

  const done = index >= chunks.length;
  const pattern = supplementFromRows(
    parts.length > 0 ? mergePatterns(parts) : emptyPattern(),
    pages,
  );
  let error: string | null = null;
  if (done && missed > 0) {
    error = `Qwen could not read ${missed} section${missed === 1 ? '' : 's'}. The other sections and every extracted row are stored.`;
  }
  if (done && note) error = error ? `${error} ${note}` : note;

  return {
    model,
    status: done ? (error ? 'rows_only' : 'ready') : 'extracting',
    pattern,
    error: done ? error : null,
    cursor: { next: index, total: chunks.length, missed },
    durationMs: Date.now() - started,
  };
}
