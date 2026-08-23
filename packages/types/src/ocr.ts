/** Structured OCR output — matrix + consumable object for downstream use. */

export interface OcrWordBox {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrCell {
  row: number;
  col: number;
  text: string;
  confidence: number;
  words: OcrWordBox[];
}

/** One logical block from the photo: header + note + amounts. */
export interface OcrDocumentItem {
  header: string[];
  note: string[];
  amounts: string[];
}

export interface OcrMatrix {
  id: string;
  createdAt: string;
  source: {
    fileName: string;
    mimeType: string;
    originalBytes: number;
    processedWidth: number;
    processedHeight: number;
  };
  /** Row-major cell text (empty string for blanks). */
  matrix: string[][];
  rows: number;
  cols: number;
  cells: OcrCell[];
  /** Semantic items reconstructed from layout (header / note / amounts). */
  items: OcrDocumentItem[];
  rawText: string;
  meanConfidence: number;
  /**
   * Consumable payload:
   * - cells: flat "r{n}c{n}" map
   * - records: row objects when a header row is detected
   */
  object: {
    rows: number;
    cols: number;
    cells: Record<string, string>;
    records: Array<Record<string, string>>;
  };
}

export function buildOcrObject(matrix: string[][]): OcrMatrix['object'] {
  const rows = matrix.length;
  const cols = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const cells: Record<string, string> = {};

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      cells[`r${r}c${c}`] = matrix[r]?.[c] ?? '';
    }
  }

  const header = (matrix[0] ?? []).map((h) => h.trim());
  const hasHeader =
    rows > 1 &&
    header.length === cols &&
    header.every((h) => h.length > 0) &&
    header.every((h) => Number.isNaN(Number(h.replace(/[$,%]/g, ''))));

  const records: Array<Record<string, string>> = [];
  if (hasHeader) {
    const keys = header.map((h, i) => slugKey(h) || `col_${i}`);
    for (let r = 1; r < rows; r += 1) {
      const record: Record<string, string> = {};
      for (let c = 0; c < cols; c += 1) {
        record[keys[c]!] = matrix[r]?.[c] ?? '';
      }
      records.push(record);
    }
  }

  return { rows, cols, cells, records };
}

function slugKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
