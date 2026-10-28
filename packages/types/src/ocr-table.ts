import type { OcrAiPage, OcrNormalizedRow, OcrPatternDocument } from './ocr-ai';

export const OCR_TABLE_COLUMNS = ['Position / variable', 'Description / calculation', 'Period / result'] as const;

/** Printed IDs stay unchanged; canonical matching is handled separately. */
export function ocrPositionId(text: string): string | null {
  return /^\s*(\d+(?:\.\d+){2,}(?:\.?[a-z]|\s+[a-z])?)(?=\s|$)/i.exec(text)?.[1] ?? null;
}

const VARIABLE = /^[A-ZÄÖÜ][A-ZÄÖÜ\d_]{0,15}$/u;
const COLUMN_HEADER = /^(?:Pos\.?\s*Nr\.?\s+Stichwort\s+LZ|Variable\s+Berechnung\s+Ergebnis\s*EH)$/i;
const PAGE_NUMBER = /^(?:\d{2}\.\d{2}\.\d{4}\s+)?(?:Seite|Page)\s*:?\s*\d+\s*(?:\/|von|of)\s*\d+$/i;
// Match only a terminal value, never a number embedded inside a calculation.
const RESULT = /(?:^|\s)([+−-]?(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.]\d+)?(?:\s*(?:[\p{L}€%][\p{L}\p{N}²³%€°/]*))?)$/u;

/** Reconstruct three semantic columns without changing or evaluating source values. */
export function ocrSourceTableCells(source: string): [string, string, string] {
  if (source.includes('\t')) {
    const pieces = source.split('\t').map((cell) => cell.trim());
    if (pieces.length >= 3) {
      const first = pieces[0]!;
      const middle = pieces.slice(1, -1).filter(Boolean).join(' ');
      const last = pieces.at(-1)!;
      if (!first || ocrPositionId(first) === first || VARIABLE.test(first)) return [first, middle, last];
      // A long calculation may begin in the physical position column.
      return ['', [first, middle].filter(Boolean).join(' '), last];
    }
  }
  const text = source.trim();
  const id = ocrPositionId(text);
  let first = id ?? '';
  let rest = id ? text.slice(id.length).trim() : text;
  const period = id ? /(?:^|\s)(\d{4}-\d{2})$/.exec(rest) : null;
  const result = period ?? RESULT.exec(rest);
  let last = '';
  if (result) {
    last = result[1]!;
    rest = rest.slice(0, result.index).trim();
  }
  if (!first && last) {
    const variable = /^([A-ZÄÖÜ][A-ZÄÖÜ\d_]{0,15})\s+(?=[+−\-\d(])/.exec(rest);
    if (variable) {
      first = variable[1]!;
      rest = rest.slice(variable[0].length);
    }
  }
  return [first, rest, last];
}

function tokens(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
}

function sameValue(left: string, right: string): boolean {
  const expected = tokens(left);
  const actual = tokens(right);
  return expected.length === actual.length && expected.every((token, i) => token === actual[i]);
}

/** One continuous body table. Original pages remain the immutable audit source. */
export function normalizeOcrTable(pages: OcrAiPage[], pattern?: OcrPatternDocument | null) {
  const aiRows = new Map((pattern?.normalizedRows ?? []).map((row) => [`${row.page}:${row.row}`, row]));
  const rows: OcrNormalizedRow[] = [];
  let pdfTypeId: string | null = null;
  for (const page of pages) {
    const flat = page.rows.map((row) => row.replace(/\s+/g, ' ').trim());
    const header = flat.findIndex((row) => COLUMN_HEADER.test(row));
    // Only discard the letterhead when a recognizable table header delimits it.
    const bodyStart = header >= 0 ? header + 1 : 0;
    const footer = flat.findIndex((row, index) => index >= Math.max(bodyStart, flat.length - 4)
      && /^erstellt\s*:/i.test(row) && /Für den Auftrag(?:nehmer|geber)/i.test(row));
    for (let row = 0; row < page.rows.length; row += 1) {
      const source = page.rows[row]!;
      const text = flat[row]!;
      if (row < bodyStart || /^Aufma[ßs]blatt\b/i.test(text)) {
        const type = /\b\d+\.[\p{L}]+(?:[-/][\p{L}\p{N}.]+)+/u.exec(text)?.[0];
        if (type && !pdfTypeId) pdfTypeId = type;
      }
      if (row < bodyStart || (footer >= 0 && row >= footer) || !text
        || COLUMN_HEADER.test(text) || PAGE_NUMBER.test(text) || text === '[IMAGE]') continue;

      const expected = ocrSourceTableCells(source);
      const id = ocrPositionId(expected[0]);
      const ai = aiRows.get(`${page.page}:${row}`);
      const cells = ai?.cells.map((cell, index) => cell === '-' && expected[index] === '' ? '' : cell.trim());
      // Validate column placement as well as content. Restoring source must never
      // collapse a formula and its result back into one full-width cell.
      const faithful = Boolean(ai && cells?.length === 3 && (ai.id ?? null) === id
        && expected.every((value, index) => sameValue(value, cells[index]!)));
      rows.push({ page: page.page, row, id, cells: faithful ? cells! : expected,
        ...(!faithful || ai?.sourceFallback ? { sourceFallback: true } : {}) });
    }
  }
  if (!pdfTypeId && pattern?.pdfTypeId) {
    const candidate = pattern.pdfTypeId.trim();
    if (candidate && pages.some((page) => page.rows.some((row) => row.includes(candidate)))) pdfTypeId = candidate;
  }
  return { pdfTypeId, columns: [...OCR_TABLE_COLUMNS], rows };
}
