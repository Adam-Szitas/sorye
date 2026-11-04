/** Row transcript sent to Qwen, plus the pattern JSON stored afterwards. */
import { normalizeOcrTable, readableOcrLine } from './ocr-table';
export { normalizeOcrTable, ocrSourceTableCells, ocrPositionId, readableOcrLine, OCR_TABLE_COLUMNS } from './ocr-table';

export const OCR_IMAGE_MARKER = '[IMAGE]';
export const OCR_MATH_OPEN = '[MATH]';
export const OCR_MATH_CLOSE = '[/MATH]';

/**
 * Display text for a stored row or an older pattern field.
 * New page transcripts are already the visible line. This does not rewrite them in storage.
 * Older pattern JSON may still contain `_` gaps and `[MATH]` tags. Those become spaces.
 * `[IMAGE]` becomes the word "figure".
 * Models sometimes rewrote `[MATH]/` as `/MATH]` and left the real `[/MATH]`.
 */
export function ocrReadingText(text: string): string {
  return text
    .replaceAll(OCR_MATH_OPEN, ' ')
    .replaceAll(OCR_MATH_CLOSE, ' ')
    .replaceAll('/MATH]', ' ')
    .replaceAll('MATH]', ' ')
    .replaceAll('[MATH', ' ')
    .replaceAll('[/MATH', ' ')
    .replaceAll(OCR_IMAGE_MARKER, ' [figure] ')
    .replaceAll('IMAGE]', ' [figure] ')
    .replaceAll('[IMAGE', ' [figure] ')
    .replace(/_+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function readableRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const text = ocrReadingText(value);
    if (text) out[key] = text;
  }
  return out;
}

/**
 * Pattern JSON as a person should read it.
 * Math spans and image markers stay intact for a later pass.
 */
export function readablePattern(pattern: OcrPatternDocument): OcrPatternDocument {
  return {
    ...pattern,
    summary: ocrReadingText(pattern.summary),
    patterns: pattern.patterns.map((hit) => ({
      ...hit,
      description: ocrReadingText(hit.description),
    })),
    records: pattern.records.map(readableRecord),
    fields: readableRecord(pattern.fields),
  };
}

/**
 * Amounts as they appear, including a space-grouped thousand such as `96 491,29`.
 * The space is part of the numeral. It is not a column break.
 */
const AMOUNT_TOKEN = /\d{1,3}(?: \d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;
const GROUPED_AMOUNT = /\d{1,3}(?: \d{3})+(?:,\d+)?/g;

function amountTokens(text: string): string[] {
  return text.match(AMOUNT_TOKEN) ?? [];
}

function groupedAmounts(text: string): string[] {
  return text.match(GROUPED_AMOUNT) ?? [];
}

function rowCells(row: string): string[] {
  return row.split('\t').map((cell) => cell.trim());
}

/**
 * Left-to-right pieces of one stored line.
 * A tab is a column already stored in the line.
 * Otherwise a space-grouped amount stays one piece, including a unit written on it (`96 491,29/ PA`).
 * This does not sum or invent columns.
 */
const UNIT_SUFFIX = String.raw`\s*\/\s*[^\s\d]+|\s+[A-Za-zÄÖÜäöüß°²³]+\d?`;
const LISTING_PIECE =
  new RegExp(String.raw`(\d{1,3}(?: \d{3})+(?:,\d+)?|\d+,\d+)(?:${UNIT_SUFFIX})?|(?<![\d.])\d+(?:${UNIT_SUFFIX})?(?![\d.])`, 'g');
const POSITION_CODE = /^\d{2}(?:\.\d{2})+(?:\.[A-Za-z0-9]+)?/;

export function listingPieces(row: string): string[] {
  if (row.includes('\t')) return row.split('\t').map((cell) => readableOcrLine(cell)).filter((cell) => cell.length > 0);
  const line = readableOcrLine(row);
  const pieces: string[] = [];
  const pattern = new RegExp(LISTING_PIECE.source, 'g');
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    const text = line.slice(last, index).trim();
    if (text) pieces.push(text);
    const piece = match[0].trim();
    if (piece) pieces.push(piece);
    last = index + match[0].length;
  }
  const tail = line.slice(last).trim();
  if (tail) pieces.push(tail);
  return pieces;
}

/** A following listing line whose amounts belong under the position above it. */
function isAmountContinuation(row: string): boolean {
  if (row.includes('\t')) {
    const cells = rowCells(row);
    if ((cells[0] ?? '') !== '') return false;
    return amountTokens(row).length > 0;
  }
  const trimmed = readableOcrLine(row);
  if (!trimmed || POSITION_CODE.test(trimmed)) return false;
  if (!/\d{1,3}(?: \d{3})+(?:,\d+)?|\d+,\d+|(?<![\d.])\d+\s+[A-Za-zÄÖÜäöüß°²³]/.test(trimmed)) return false;
  const rest = trimmed
    .replace(/\d{1,3}(?: \d{3})+(?:,\d+)?/g, ' ')
    .replace(/\d+,\d+/g, ' ')
    .replace(/\s*\/\s*[^\s\d]+/g, ' ')
    .replace(/\s+[A-Za-zÄÖÜäöüß°²³]+\d?/g, ' ')
    .replace(/(?<![\d.])\d+(?![\d.])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return rest.length < 8;
}

/**
 * True when a model number is only a piece of a space-grouped amount on this row.
 * `491,29` is a piece of `96 491,29`. The full grouped amount is not a piece of itself.
 */
function isSplitGroupedNumber(row: string, value: string): boolean {
  const pieces = amountTokens(ocrReadingText(value));
  if (pieces.length === 0) return false;
  return pieces.some((piece) =>
    groupedAmounts(ocrReadingText(row)).some((whole) => {
      if (whole === piece) return false;
      const parts = whole.split(' ');
      if (parts.length < 2) return false;
      if (piece === parts[0]) return true;
      for (let index = 1; index < parts.length; index += 1) {
        if (parts.slice(index).join(' ') === piece) return true;
      }
      return false;
    }),
  );
}

/** A model value may stay only when every amount in it is a whole token of this row. */
function valueFitsRow(value: string, row: string): boolean {
  const readableValue = ocrReadingText(value);
  const readableRow = ocrReadingText(row);
  if (!readableValue || !readableRow.includes(readableValue)) return false;
  if (isSplitGroupedNumber(row, value)) return false;
  const rowAmounts = new Set(amountTokens(readableRow));
  return amountTokens(readableValue).every((token) => rowAmounts.has(token));
}

function lineCells(row: string): string[] {
  return row.includes('\t') ? rowCells(row) : listingPieces(row);
}

function recordFromRow(row: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  lineCells(row).forEach((cell, index) => {
    if (cell) out[`c${index}`] = cell;
  });
  return Object.keys(out).length > 0 ? out : null;
}

function isLineProjection(record: Record<string, string>, row: string): boolean {
  const cells = lineCells(row);
  const entries = Object.entries(record);
  if (entries.length === 0) return false;
  return entries.every(([key, value]) => {
    const match = /^c(\d+)$/.exec(key);
    if (!match) return false;
    return cells[Number(match[1])] === ocrReadingText(value);
  });
}

interface ListingLine {
  page: number;
  row: string;
}

/**
 * Put model records back on the stored listing.
 * Each amount stays on the line where it was stored. A space inside `96 491,29` stays put.
 * Nothing is summed, rounded, or moved onto a neighboring line.
 */
export function alignRecordsToRows(
  records: Array<Record<string, string>>,
  pages: OcrAiPage[],
): Array<Record<string, string>> {
  const lines: ListingLine[] = pages.flatMap((page) =>
    page.rows.map((row) => ({ page: page.page, row })),
  );
  if (lines.length === 0 || records.length === 0) return records;

  const used = new Set<number>();
  const out: Array<Record<string, string>> = [];

  const positionStart = (index: number): number => {
    let start = index;
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const line = lines[cursor]!;
      if (line.page !== lines[index]!.page) break;
      start = cursor;
      if (!isAmountContinuation(line.row)) break;
    }
    return start;
  };

  const blockLength = (anchor: number): number => {
    const start = positionStart(anchor);
    const page = lines[start]!.page;
    let count = 0;
    for (let index = start; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (index > start && (line.page !== page || !isAmountContinuation(line.row))) break;
      count += 1;
    }
    return count;
  };

  const projectBlock = (anchor: number) => {
    const start = positionStart(anchor);
    const page = lines[start]!.page;
    for (let index = start; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (index > start && (line.page !== page || !isAmountContinuation(line.row))) break;
      if (used.has(index)) continue;
      const projected = recordFromRow(line.row);
      if (!projected) continue;
      used.add(index);
      out.push(projected);
    }
  };

  for (const record of records) {
    const fields = Object.entries(record).filter(([, value]) => ocrReadingText(value));
    if (fields.length === 0) continue;

    let best = -1;
    let bestScore = 0;
    lines.forEach((line, index) => {
      const score = fields.reduce(
        (sum, [, value]) => sum + (valueFitsRow(value, line.row) ? 1 : 0),
        0,
      );
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    });

    if (best >= 0 && isLineProjection(record, lines[best]!.row)) {
      if (!used.has(best)) {
        used.add(best);
        out.push(record);
      }
      continue;
    }

    const fragmentRows: number[] = [];
    const foreignRows: number[] = [];
    for (const [, value] of fields) {
      lines.forEach((line, index) => {
        if (isSplitGroupedNumber(line.row, value)) fragmentRows.push(index);
        else if (
          best >= 0 &&
          valueFitsRow(value, line.row) &&
          !valueFitsRow(value, lines[best]!.row)
        ) {
          foreignRows.push(index);
        }
      });
    }

    const anchored = best >= 0 ? lines[best]!.row : '';
    const expand =
      fragmentRows.length > 0 ||
      foreignRows.length > 0 ||
      anchored.includes('\t') ||
      (best >= 0 && blockLength(best) > 1);
    if (best < 0 && fragmentRows.length === 0) {
      out.push(record);
      continue;
    }
    if (!expand) {
      if (best >= 0) used.add(best);
      out.push(record);
      continue;
    }

    if (best >= 0) projectBlock(best);
    for (const index of fragmentRows) projectBlock(index);
    for (const index of foreignRows) projectBlock(index);
  }

  return out.length > 0 ? out : records;
}

/** Column keys for the reading table. Positional cells stay left to right, including gaps. */
export function recordTableColumns(records: Array<Record<string, string>>): string[] {
  const keys: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  const positional = keys.filter((key) => /^c\d+$/.test(key));
  if (positional.length === 0) return keys;
  const max = Math.max(...positional.map((key) => Number(key.slice(1))));
  const rest = keys.filter((key) => !/^c\d+$/.test(key));
  const columns =
    max > 40
      ? positional.sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)))
      : Array.from({ length: max + 1 }, (_, index) => `c${index}`);
  return rest.length === 0 ? columns : [...columns, ...rest];
}

export function recordColumnLabel(column: string): string {
  return /^c\d+$/.test(column) ? '' : column;
}

/** One PDF page as a single list of rows. There are no columns. */
export interface OcrAiPage {
  page: number;
  rows: string[];
}

export interface OcrPatternHit {
  name: string;
  description: string;
  repeats: boolean;
  page: number;
  rowIndexes: number[];
}

/** A table row classified by the model, retaining the source location. */
export interface OcrMatrixRow {
  page: number;
  row: number;
  id: string;
  cells: string[];
}

export interface OcrUnclearFinding {
  page: number;
  finding: string;
}

/** One Node-extracted source row, fully represented in the AI-normalized table. */
export interface OcrNormalizedRow {
  page: number;
  row: number;
  id: string | null;
  cells: string[];
  /** True when source values supplied or repaired the three normalized cells. */
  sourceFallback?: boolean;
}

/** Canonical matching for schedule IDs such as `01.11.05 A` and `1.11.5A`. */
export function normalizeOcrMatrixId(raw: string): string {
  const match = /^\s*(\d+(?:\.\d+)+)\s*\.?\s*([a-z])?\s*$/i.exec(raw);
  if (!match) return `raw:${raw.trim().replace(/\s+/g, ' ').toUpperCase()}`;
  const address = match[1]!
    .split('.')
    .map((part) => part.replace(/^0+(?=\d)/, ''))
    .join('.');
  return `${address}${match[2]?.toUpperCase() ?? ''}`;
}

/**
 * Structured reading of a row transcript.
 * Math spans are copied verbatim — a later pass will interpret them.
 */
export interface OcrPatternDocument {
  documentKind: string;
  /** Printed document type, e.g. 7.RH-TOP27-TOP23; separate from the stored PDF ID. */
  pdfTypeId?: string | null;
  /** Server-owned prompt/input version, used to safely resume chunked inference. */
  normalizationVersion?: number;
  summary: string;
  patterns: OcrPatternHit[];
  records: Array<Record<string, string>>;
  fields: Record<string, string>;
  math: Array<{ page: number; row: number; text: string }>;
  images: Array<{ page: number; row: number; marker: string }>;
  /** Identifiers and matrix cells extracted by the model, aligned to page rows. */
  matrixRows?: OcrMatrixRow[];
  /** Meaningful body rows across all pages; headers and footers are excluded. */
  normalizedRows?: OcrNormalizedRow[];
  /** Shared AI column labels, in the same order as normalizedRows[].cells. */
  normalizedColumns?: string[];
  /** Only uncertainty, missing values, or ambiguous reading issues by page. */
  unclearFindings?: OcrUnclearFinding[];
}

export type OcrAnalysisStatus = 'extracting' | 'ready' | 'rows_only';

/** One page's place in the document-wide line vector. */
export interface OcrPageNote {
  page: number;
  complete: boolean;
  warning: string | null;
}

/**
 * Provenance for `lines`, which is `pages` flattened in order.
 * `pageStarts[i]` is the index of `pages[i].rows[0]` inside `lines`.
 */
export interface OcrDocumentVector {
  version: 1;
  pageStarts: number[];
  lineCount: number;
  notes: OcrPageNote[];
  /** Present while Qwen is still walking the document. `next` is the next slice index. */
  cursor?: { next: number; total: number; missed: number };
  /**
   * ISO time of the first model request for this analysis.
   * Absent while the job is queued or still extracting PDF rows.
   */
  gpuStartedAt?: string;
  /** ISO time model work finished. Absent while a model request is still running. */
  gpuFinishedAt?: string;
}

export type OcrAmountOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';

export interface OcrAmountFilter {
  notation: string;
  op: OcrAmountOp;
  value: number;
}

/** Search over stored PDF extractions. Dates are UTC calendar days. */
export interface OcrLibraryQuery {
  from?: string;
  to?: string;
  name?: string;
  code?: string;
  notations?: string[];
  amounts?: OcrAmountFilter[];
  ids?: string[];
  /** document: keep a whole extraction. fields: return only the matching keys and rows. */
  scope?: 'document' | 'fields';
}

export interface OcrLibraryHit {
  id: string;
  fileName: string;
  createdAt: string;
  status: OcrAnalysisStatus;
  documentKind: string;
  fields: Record<string, string>;
  records: Array<Record<string, string>>;
  recordCount: number;
}

export interface OcrAnalysis {
  id: string;
  workspaceId: string;
  createdBy: string;
  fileName: string;
  model: string;
  status: OcrAnalysisStatus;
  pages: OcrAiPage[];
  /** Ordered lines for the whole PDF. Page breaks live in `vector.pageStarts`. */
  lines: string[];
  vector: OcrDocumentVector;
  pattern: OcrPatternDocument | null;
  error: string | null;
  createdAt: string;
  /** When model inference for this analysis started. Null if it never ran. */
  workStartedAt?: string | null;
  /** When the analysis left `extracting`. */
  workFinishedAt?: string | null;
  /** Accumulated model time in milliseconds. Null if inference never ran. */
  durationMs?: number | null;
}

/** Bounded library listing; full transcript and pattern are fetched by ID. */
export type OcrAnalysisSummary = Pick<OcrAnalysis, 'id' | 'fileName' | 'model' | 'status' | 'error' | 'createdAt'>;

/** `GPU m:ss` from the first model request. Queue and PDF extraction are not included. */
export function formatOcrGpuDuration(
  startedAt: string,
  finishedAt?: string | null,
  now = Date.now(),
): string | null {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const end = finishedAt ? Date.parse(finishedAt) : now;
  if (!Number.isFinite(end)) return null;
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `GPU ${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** `GPU m:ss` from a stored model duration in milliseconds. */
export function formatOcrGpuClock(durationMs: number): string | null {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `GPU ${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Content-only export: structured rows and findings, without a text transcript. */
export function buildOcrReadingDocument(analysis: OcrAnalysis) {
  const pattern = analysis.pattern;
  // Also repairs older saved readings without another inference or upload.
  const table = normalizeOcrTable(analysis.pages, pattern);
  return {
    id: analysis.id,
    fileName: analysis.fileName,
    pdfTypeId: table.pdfTypeId,
    status: analysis.status,
    ...(analysis.error ? { warning: analysis.error } : {}),
    documentKind: pattern?.documentKind ?? 'Document',
    normalizedData: {
      columns: table.columns,
      rows: table.rows.map(({ page, row, id, cells, sourceFallback }) => ({
        page, row, id, cells: [...cells], ...(sourceFallback ? { sourceFallback: true } : {}),
      })),
    },
    unclearFindings: (pattern?.unclearFindings ?? []).map(({ page, finding }) => ({ page, finding })),
  };
}
