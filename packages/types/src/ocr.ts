/** Structured OCR / PDF text output — layout matrix + consumable object. */

export interface OcrTextStyle {
  /** Font size in rendered pixels (approx). */
  fontSize: number;
  /** PDF font name when available. */
  fontName?: string;
  bold: boolean;
  italic: boolean;
  /**
   * Size vs page median:
   * sm < ~0.85× · md ≈ normal · lg ≥ ~1.2× · xl ≥ ~1.5×
   */
  sizeRank: 'sm' | 'md' | 'lg' | 'xl';
}

export interface OcrWordBox {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  style?: OcrTextStyle;
}

export interface OcrCell {
  row: number;
  col: number;
  text: string;
  confidence: number;
  words: OcrWordBox[];
  style?: OcrTextStyle;
}

export type OcrCellAlign = 'left' | 'center' | 'right';

/** Evaluated role of a layout row from typography + structure. */
export type OcrRowRole = 'title' | 'header' | 'body' | 'emphasis' | 'empty';

export interface OcrLayoutCell {
  text: string;
  align: OcrCellAlign;
  style: OcrTextStyle;
  confidence: number;
  /** Original word boxes that formed this cell. */
  words: OcrWordBox[];
}

export interface OcrLayoutRow {
  role: OcrRowRole;
  cells: OcrLayoutCell[];
  /** Median font size of non-empty cells in this row. */
  fontSize: number;
  boldShare: number;
}

/** Precise page grid from layout analysis (not forced header/note/amounts). */
export interface OcrPageLayout {
  rows: OcrLayoutRow[];
  cols: number;
  /** Column widths as percentages (sum ≈ 100). */
  columnWidths: number[];
  /** Page-level median font size used for sizeRank. */
  medianFontSize: number;
  /** Plain string matrix mirror for consumers. */
  matrix: string[][];
}

/** @deprecated Prefer OcrPageLayout — kept for older item-table UI. */
export interface OcrDocumentCell {
  text: string;
  colspan?: number;
  align?: OcrCellAlign;
  style?: OcrTextStyle;
}

/** @deprecated Prefer OcrPageLayout. */
export interface OcrDocumentItem {
  header: OcrDocumentCell[];
  note: OcrDocumentCell[];
  amounts: OcrDocumentCell[];
  columnWidths: number[];
  segmentCount: number;
}

/** @deprecated Use OcrDocumentCell[] — kept for quick text access. */
export function itemRowTexts(cells: OcrDocumentCell[]): string[] {
  const out: string[] = [];
  for (const cell of cells) {
    const span = cell.colspan ?? 1;
    for (let i = 0; i < span; i += 1) out.push(i === 0 ? cell.text : '');
  }
  return out;
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
    pdfPage?: number;
    pdfPageCount?: number;
    /** How text was obtained. */
    extractMode?: 'pdf-text' | 'ocr';
  };
  /** Row-major cell text (empty string for blanks). */
  matrix: string[][];
  rows: number;
  cols: number;
  cells: OcrCell[];
  /** Precise evaluated layout matrix with style metadata. */
  layout: OcrPageLayout;
  /** @deprecated Semantic item split — prefer `layout`. */
  items: OcrDocumentItem[];
  rawText: string;
  meanConfidence: number;
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

export function sizeRankFromFont(
  fontSize: number,
  medianFontSize: number,
): OcrTextStyle['sizeRank'] {
  const base = Math.max(1, medianFontSize);
  const ratio = fontSize / base;
  if (ratio >= 1.5) return 'xl';
  if (ratio >= 1.18) return 'lg';
  if (ratio <= 0.85) return 'sm';
  return 'md';
}

export function inferBoldFromFontName(fontName: string | undefined): boolean {
  if (!fontName) return false;
  return /bold|black|heavy|semibold|demi|extrabold|fett/i.test(fontName);
}

export function inferItalicFromFontName(fontName: string | undefined): boolean {
  if (!fontName) return false;
  return /italic|oblique|kursiv/i.test(fontName);
}
