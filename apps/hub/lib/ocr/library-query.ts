import {
  alignRecordsToRows,
  normalizeOcrTable,
  ocrReadingText,
  type OcrAiPage,
  type OcrAmountFilter,
  type OcrAmountOp,
  type OcrLibraryHit,
  type OcrLibraryQuery,
  type OcrPatternDocument,
} from '@sorye/types';

export const OCR_LIBRARY_LIMIT = 50;
const MAX_RETURNED_RECORDS = 500;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const OPS = new Set<OcrAmountOp>(['gt', 'gte', 'lt', 'lte', 'eq']);

export interface OcrLibrarySource {
  id: string;
  fileName: string;
  createdAt: string;
  status: OcrLibraryHit['status'];
  pattern: OcrPatternDocument | null;
  /** Present for display. Search still matches the stored pattern. */
  pages?: OcrAiPage[];
}

export function parseUtcDay(value: string): string | null {
  const match = DAY.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Inclusive UTC day. The next midnight is the exclusive end. */
export function utcDayRange(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00.000Z`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/** Read a stored amount. Spaces and grouping marks are not part of the number. */
export function parseAmount(raw: string): number | null {
  let text = raw.trim().replace(/[\s_]/g, '').replace(/[^\d,.\-]/g, '');
  if (!/^-?\d/.test(text)) return null;
  const european = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/;
  const grouped = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
  if (european.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (grouped.test(text)) text = text.replace(/,/g, '');
  else if (text.includes(',') && !text.includes('.')) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function compareAmount(actual: number, op: OcrAmountOp, expected: number): boolean {
  if (op === 'gt') return actual > expected;
  if (op === 'gte') return actual >= expected;
  if (op === 'lt') return actual < expected;
  if (op === 'lte') return actual <= expected;
  return Math.abs(actual - expected) < 1e-6;
}

/** Display copy. Code and amount matching still read the stored strings. */
function readableRecord(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const text = ocrReadingText(value);
    if (text) out[key] = text;
  }
  return out;
}

function notationKeys(notation: string): { fields: boolean; records: boolean; key: string } {
  const trimmed = notation.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('fields.')) {
    return { fields: true, records: false, key: trimmed.slice('fields.'.length) };
  }
  if (lower.startsWith('records.')) {
    return { fields: false, records: true, key: trimmed.slice('records.'.length) };
  }
  return { fields: true, records: true, key: trimmed };
}

function keyEquals(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function valuesFor(
  pattern: OcrPatternDocument,
  notation: string,
): Array<{ where: 'fields' | 'records'; key: string; value: string; record?: Record<string, string> }> {
  const target = notationKeys(notation);
  const found: Array<{ where: 'fields' | 'records'; key: string; value: string; record?: Record<string, string> }> = [];
  if (target.fields) {
    for (const [key, value] of Object.entries(pattern.fields)) {
      if (keyEquals(key, target.key)) found.push({ where: 'fields', key, value });
    }
  }
  if (target.records) {
    for (const record of pattern.records) {
      for (const [key, value] of Object.entries(record)) {
        if (keyEquals(key, target.key)) found.push({ where: 'records', key, value, record });
      }
    }
    const positional = /^c(\d+)$/i.exec(target.key);
    if (positional) {
      const column = Number(positional[1]);
      for (const row of pattern.normalizedRows ?? pattern.matrixRows ?? []) {
        const value = row.cells[column] ?? '';
        if (value) found.push({
          where: 'records', key: target.key, value,
          record: Object.fromEntries(row.cells.map((cell, index) => [`c${index}`, cell])),
        });
      }
    }
  }
  return found;
}

function hasNotation(pattern: OcrPatternDocument, notation: string): boolean {
  return valuesFor(pattern, notation).length > 0;
}

function containsCode(value: string, code: string): boolean {
  return value.toLowerCase().includes(code.toLowerCase());
}

function patternHasCode(pattern: OcrPatternDocument, code: string): boolean {
  if (pattern.pdfTypeId && containsCode(pattern.pdfTypeId, code)) return true;
  for (const value of Object.values(pattern.fields)) {
    if (containsCode(value, code)) return true;
  }
  for (const record of pattern.records) {
    for (const value of Object.values(record)) {
      if (containsCode(value, code)) return true;
    }
  }
  for (const row of pattern.normalizedRows ?? pattern.matrixRows ?? []) {
    if (row.cells.some((value) => containsCode(value, code))) return true;
  }
  return false;
}

function amountMatches(pattern: OcrPatternDocument, filter: OcrAmountFilter): boolean {
  return valuesFor(pattern, filter.notation).some((item) => {
    const amount = parseAmount(item.value);
    return amount != null && compareAmount(amount, filter.op, filter.value);
  });
}

function project(
  source: OcrLibrarySource,
  query: OcrLibraryQuery,
): OcrLibraryHit | null {
  let pattern = source.pattern ?? {
    documentKind: 'unknown',
    summary: '',
    patterns: [],
    records: [],
    fields: {},
    math: [],
    images: [],
    matrixRows: [],
    unclearFindings: [],
  };
  if (pattern.records.length === 0 && source.pages?.length) {
    const table = normalizeOcrTable(source.pages, pattern);
    pattern = { ...pattern, pdfTypeId: table.pdfTypeId, normalizedRows: table.rows, normalizedColumns: table.columns };
  }
  if (query.name && !source.fileName.toLowerCase().includes(query.name.toLowerCase())) return null;
  for (const notation of query.notations ?? []) {
    if (!hasNotation(pattern, notation)) return null;
  }
  if (query.code && !patternHasCode(pattern, query.code)) return null;
  for (const filter of query.amounts ?? []) {
    if (!amountMatches(pattern, filter)) return null;
  }

  let fields = { ...pattern.fields };
  const matrixRecords = (pattern.normalizedRows ?? pattern.matrixRows ?? []).map((row) =>
    Object.fromEntries(row.cells.map((cell, index) => [`c${index}`, cell])),
  );
  let records = pattern.records.length > 0
    ? pattern.records.map((record) => ({ ...record }))
    : matrixRecords;
  if (query.scope === 'fields') {
    const amountFilters = query.amounts ?? [];
    const wanted = new Set<string>();
    for (const notation of query.notations ?? []) wanted.add(notationKeys(notation).key.toLowerCase());
    for (const filter of amountFilters) wanted.add(notationKeys(filter.notation).key.toLowerCase());
    const pick = (record: Record<string, string>) =>
      wanted.size === 0
        ? record
        : Object.fromEntries(Object.entries(record).filter(([key]) => wanted.has(key.toLowerCase())));
    fields = pick(fields);
    if (query.code) {
      fields = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => containsCode(value, query.code!)),
      );
    }
    fields = Object.fromEntries(
      Object.entries(fields).filter(([key, value]) =>
        amountFilters.every((filter) => {
          if (!keyEquals(notationKeys(filter.notation).key, key)) return true;
          const amount = parseAmount(value);
          return amount != null && compareAmount(amount, filter.op, filter.value);
        }),
      ),
    );
    records = (pattern.records.length > 0 ? pattern.records : matrixRecords).filter((record) => {
      if (query.code && !Object.values(record).some((value) => containsCode(value, query.code!))) return false;
      return amountFilters.every((filter) => {
        const key = notationKeys(filter.notation).key;
        const entry = Object.entries(record).find(([name]) => keyEquals(name, key));
        if (!entry) return false;
        const amount = parseAmount(entry[1]);
        return amount != null && compareAmount(amount, filter.op, filter.value);
      });
    }).map(pick);
  } else if (pattern.records.length > 0 && source.pages && source.pages.length > 0) {
    records = alignRecordsToRows(records, source.pages);
  }

  return {
    id: source.id,
    fileName: source.fileName,
    createdAt: source.createdAt,
    status: source.status,
    documentKind: pattern.documentKind || 'unknown',
    fields: readableRecord(fields),
    records: records.slice(0, MAX_RETURNED_RECORDS).map(readableRecord),
    recordCount: records.length,
  };
}

export function parseLibraryQuery(body: unknown): OcrLibraryQuery {
  const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const query: OcrLibraryQuery = {};
  if (typeof source.from === 'string' && source.from.trim()) {
    const day = parseUtcDay(source.from.trim());
    if (!day) throw new Error('From date must be a real YYYY-MM-DD day.');
    query.from = day;
  }
  if (typeof source.to === 'string' && source.to.trim()) {
    const day = parseUtcDay(source.to.trim());
    if (!day) throw new Error('To date must be a real YYYY-MM-DD day.');
    query.to = day;
  }
  if (query.from && query.to && query.from > query.to) {
    throw new Error('The date range is reversed.');
  }
  if (typeof source.name === 'string' && source.name.trim()) {
    query.name = source.name.trim().slice(0, 180);
  }
  if (typeof source.code === 'string' && source.code.trim()) {
    query.code = source.code.trim().slice(0, 80);
  }
  if (Array.isArray(source.notations)) {
    query.notations = source.notations
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim().slice(0, 80))
      .slice(0, 20);
  }
  if (Array.isArray(source.amounts)) {
    query.amounts = source.amounts.slice(0, 10).map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const notation = typeof row.notation === 'string' ? row.notation.trim().slice(0, 80) : '';
      const op = typeof row.op === 'string' ? row.op : '';
      const value = typeof row.value === 'number' ? row.value : Number(row.value);
      if (!notation || !OPS.has(op as OcrAmountOp) || !Number.isFinite(value) || Math.abs(value) > 1e15) {
        throw new Error('Each amount filter needs a field name, a comparison, and a finite number.');
      }
      return { notation, op: op as OcrAmountOp, value };
    });
  }
  if (Array.isArray(source.ids)) {
    query.ids = source.ids
      .filter((item): item is string => typeof item === 'string' && /^ocr-[a-zA-Z0-9-]{4,40}$/.test(item))
      .slice(0, OCR_LIBRARY_LIMIT);
  }
  query.scope = source.scope === 'fields' ? 'fields' : 'document';
  return query;
}

/** Last 50 extractions in the UTC date window, then names, keys, codes, and amounts. */
export function queryLibrary(rows: OcrLibrarySource[], query: OcrLibraryQuery): OcrLibraryHit[] {
  let list = rows.filter((row) => row.status === 'ready' || row.status === 'rows_only' || row.status === 'extracting');
  if (query.ids) {
    const ids = new Set(query.ids);
    list = list.filter((row) => ids.has(row.id));
  }
  list = list.filter((row) => {
    const day = row.createdAt.slice(0, 10);
    if (query.from && day < query.from) return false;
    if (query.to && day > query.to) return false;
    return true;
  });
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  if (!query.ids) list = list.slice(0, OCR_LIBRARY_LIMIT);
  return list.flatMap((row) => {
    const hit = project(row, query);
    return hit ? [hit] : [];
  });
}
