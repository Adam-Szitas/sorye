import type { OcrLayoutRow, OcrPageLayout, OcrTextStyle } from '@sorye/types';

/** Minimal Protocolio PdfTemplate shape (avoid hard dep on SDK in OCR). */
export interface OcrPdfFont {
  family?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

export interface OcrPdfTextBlock {
  type: 'text';
  content: string;
  font?: OcrPdfFont;
}

export interface OcrPdfSpacerBlock {
  type: 'spacer';
  height: number;
}

export interface OcrPdfTableColumn {
  header: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

export interface OcrPdfTableBlock {
  type: 'table';
  columns: OcrPdfTableColumn[];
  rows: string[][];
  headerBackground?: string;
  headerFont?: OcrPdfFont;
  cellFont?: OcrPdfFont;
  stripedRows?: boolean;
  stripedColor?: string;
  showBorder?: boolean;
}

export type OcrPdfBlock =
  | OcrPdfTextBlock
  | OcrPdfSpacerBlock
  | OcrPdfTableBlock;

export interface OcrPdfTemplate {
  page?: {
    size?: 'A4' | 'Letter';
    orientation?: 'portrait' | 'landscape';
    margins?: { top: number; right: number; bottom: number; left: number };
  };
  metadata?: { title?: string; author?: string; subject?: string };
  defaultFont?: OcrPdfFont;
  blocks: OcrPdfBlock[];
}

function fontFromStyle(
  style: OcrTextStyle | undefined,
  align?: 'left' | 'center' | 'right',
): OcrPdfFont {
  const sizeRank = style?.sizeRank ?? 'md';
  const size =
    sizeRank === 'xl'
      ? 18
      : sizeRank === 'lg'
        ? 14
        : sizeRank === 'sm'
          ? 9
          : 11;

  return {
    family: 'DejaVu Sans',
    size,
    bold: Boolean(style?.bold),
    italic: Boolean(style?.italic),
    color: '#1a1a1a',
    align: align ?? 'left',
  };
}

function rowText(row: OcrLayoutRow): string {
  return row.cells
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join('  ');
}

function isSparseTitleRow(row: OcrLayoutRow): boolean {
  const filled = row.cells.filter((c) => c.text.trim());
  return (
    (row.role === 'title' || row.role === 'emphasis') &&
    filled.length > 0 &&
    filled.length <= Math.max(2, Math.ceil(row.cells.length / 3))
  );
}

function cellsHaveText(cells: Array<{ text?: string }>): boolean {
  return cells.some((c) => (c.text ?? '').trim().length > 0);
}

function dropEmptyTrailingColumns(
  columns: OcrPdfTableColumn[],
  rows: string[][],
  widths: number[],
): { columns: OcrPdfTableColumn[]; rows: string[][]; widths: number[] } {
  let last = columns.length - 1;
  while (last >= 0) {
    const headerEmpty = !columns[last]!.header.trim();
    const colEmpty = rows.every((row) => !(row[last] ?? '').trim());
    if (!headerEmpty || !colEmpty) break;
    last -= 1;
  }

  const count = Math.max(1, last + 1);
  const nextWidths = widths.slice(0, count);
  const sum = nextWidths.reduce((a, b) => a + b, 0) || 100;
  return {
    columns: columns.slice(0, count).map((col, i) => ({
      ...col,
      width: `${Math.max(4, ((nextWidths[i] ?? 100 / count) / sum) * 100).toFixed(2)}%`,
    })),
    rows: rows.map((row) => row.slice(0, count)),
    widths: nextWidths,
  };
}

function trimEmptyRows(rows: string[][]): string[][] {
  const filled = rows.filter((row) => row.some((cell) => cell.trim()));
  let end = filled.length;
  while (end > 0 && !filled[end - 1]!.some((cell) => cell.trim())) end -= 1;
  return filled.slice(0, end);
}

function compactTrailingSpacers(blocks: OcrPdfBlock[]): OcrPdfBlock[] {
  const out: OcrPdfBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'spacer' && out[out.length - 1]?.type === 'spacer') {
      const prev = out[out.length - 1] as OcrPdfSpacerBlock;
      prev.height = Math.max(prev.height, block.height);
      continue;
    }
    out.push(block);
  }
  while (out.length > 0 && out[out.length - 1]!.type === 'spacer') {
    out.pop();
  }
  return out;
}

function flushTable(
  blocks: OcrPdfBlock[],
  pending: OcrLayoutRow[],
  columnWidths: number[],
): void {
  if (pending.length === 0) return;

  const usable = pending.filter((row) => cellsHaveText(row.cells));
  if (usable.length === 0) return;

  const cols = Math.max(
    1,
    ...usable.map((r) => r.cells.length),
    columnWidths.length,
  );

  const widths =
    columnWidths.length === cols
      ? columnWidths
      : Array.from({ length: cols }, () => 100 / cols);

  const headerRow = usable.find((r) => r.role === 'header');
  const dataRows = headerRow
    ? usable.filter((r) => r !== headerRow)
    : usable;

  let columns: OcrPdfTableColumn[] = Array.from({ length: cols }, (_, i) => {
    const headerText = headerRow?.cells[i]?.text.trim() ?? '';
    const align = headerRow?.cells[i]?.align ?? 'left';
    return {
      header: headerText,
      width: `${Math.max(4, widths[i] ?? 100 / cols).toFixed(2)}%`,
      align,
    };
  });

  let rows: string[][] = trimEmptyRows(
    dataRows.map((row) =>
      Array.from({ length: cols }, (_, i) => (row.cells[i]?.text ?? '').trim()),
    ),
  );

  const headersBlank = columns.every((c) => !c.header.trim());
  if (headersBlank && dataRows.length > 0 && dataRows[0]!.role === 'header') {
    const first = dataRows[0]!;
    columns = columns.map((col, i) => ({
      ...col,
      header: first.cells[i]?.text.trim() ?? '',
      align: first.cells[i]?.align ?? 'left',
    }));
    rows = trimEmptyRows(rows.slice(1));
  }

  const trimmed = dropEmptyTrailingColumns(columns, rows, widths);
  columns = trimmed.columns;
  rows = trimEmptyRows(trimmed.rows);

  if (rows.length === 0 && columns.every((c) => !c.header.trim())) return;

  // Header-only: emit as text instead of a table with blank body rows.
  if (rows.length === 0) {
    const heading = columns
      .map((c) => c.header.trim())
      .filter(Boolean)
      .join('  ');
    if (!heading) return;
    blocks.push({
      type: 'text',
      content: heading,
      font: { family: 'DejaVu Sans', size: 11, bold: true, color: '#0f172a' },
    });
    return;
  }

  const hasHeader = columns.some((c) => c.header.trim());
  blocks.push({
    type: 'table',
    columns,
    rows,
    headerBackground: hasHeader ? '#1e293b' : '#f1f5f9',
    headerFont: {
      family: 'DejaVu Sans',
      size: 10,
      bold: true,
      color: hasHeader ? '#ffffff' : '#334155',
    },
    cellFont: { family: 'DejaVu Sans', size: 10, color: '#1e293b' },
    stripedRows: true,
    stripedColor: '#f8fafc',
    showBorder: true,
  });
  blocks.push({ type: 'spacer', height: 8 });
}

function layoutToBlocks(layout: OcrPageLayout): OcrPdfBlock[] {
  const blocks: OcrPdfBlock[] = [];
  let pending: OcrLayoutRow[] = [];

  const flush = () => {
    flushTable(blocks, pending, layout.columnWidths);
    pending = [];
  };

  for (const row of layout.rows) {
    if (!row.cells.some((c) => c.text.trim())) continue;

    if (isSparseTitleRow(row)) {
      flush();
      const text = rowText(row);
      const style = row.cells.find((c) => c.text.trim())?.style;
      blocks.push({
        type: 'text',
        content: text,
        font: fontFromStyle(style),
      });
      blocks.push({ type: 'spacer', height: 6 });
      continue;
    }

    pending.push(row);
  }

  flush();
  return compactTrailingSpacers(blocks);
}

export interface BuildPdfTemplateInput {
  layouts: OcrPageLayout[];
  fileName?: string;
  title?: string;
}

/** Convert OCR page layouts into a Protocolio PdfTemplate. */
export function buildPdfTemplateFromLayouts(
  input: BuildPdfTemplateInput,
): OcrPdfTemplate {
  const title =
    input.title?.trim() ||
    (input.fileName ? `OCR · ${input.fileName}` : 'OCR Document');

  const blocks: OcrPdfBlock[] = [
    {
      type: 'text',
      content: title,
      font: { family: 'DejaVu Sans', size: 18, bold: true, color: '#0f172a' },
    },
    { type: 'spacer', height: 10 },
  ];

  input.layouts.forEach((layout, index) => {
    if (input.layouts.length > 1) {
      blocks.push({
        type: 'text',
        content: `Page ${index + 1}`,
        font: {
          family: 'DejaVu Sans',
          size: 12,
          bold: true,
          color: '#475569',
        },
      });
      blocks.push({ type: 'spacer', height: 6 });
    }
    blocks.push(...layoutToBlocks(layout));
  });

  return {
    page: {
      size: 'A4',
      orientation: 'portrait',
      margins: { top: 48, right: 42, bottom: 48, left: 42 },
    },
    metadata: {
      title,
      author: 'Sorye OCR',
      subject: 'Extracted document layout',
    },
    defaultFont: {
      family: 'DejaVu Sans',
      size: 10,
      color: '#1e293b',
    },
    blocks: compactTrailingSpacers(blocks),
  };
}
