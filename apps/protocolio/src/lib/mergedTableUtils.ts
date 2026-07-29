import type { MergedTableBlock, MergedTableCellValue, TableCellDef, TableCellValue, TableColumn } from '@protocolio/sdk';
import { removeRowHeightAt } from './tableRowHeight';
import { removeRowBackgroundAt } from './tableRowBackground';

export function cellToString(cell: TableCellValue): string {
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number') return String(cell);
  return cell.text;
}

export function parseCellDef(cell: TableCellValue): TableCellDef {
  if (typeof cell === 'object' && cell !== null && 'text' in cell) {
    return cell;
  }
  return { text: cellToString(cell) };
}

export function defaultMergedTableBlock(): MergedTableBlock {
  return {
    type: 'mergedTable',
    columns: [
      { header: 'Label', align: 'left', width: '30%' },
      { header: 'Value', align: 'left' },
    ],
    rows: [
      [{ text: 'Cell A', rowspan: 2 }, 'Cell B'],
      [null, 'Cell C'],
    ],
    showBorder: true,
    columnGap: 0,
    rowGap: 0,
  };
}

function padRow(row: MergedTableCellValue[], colCount: number): MergedTableCellValue[] {
  const next = [...row];
  while (next.length < colCount) next.push('');
  return next.slice(0, colCount);
}

/** Whether column `col` in body row `targetRow` is covered by a rowspan from above */
export function isSlotCovered(rows: MergedTableBlock['rows'], targetRow: number, col: number): boolean {
  for (let ri = 0; ri < targetRow && ri < rows.length; ri++) {
    const row = padRow(rows[ri] ?? [], rows[0]?.length ?? 1);
    for (let c = 0; c < row.length; c++) {
      const raw = row[c];
      if (raw == null) continue;
      const def = parseCellDef(raw);
      const rowspan = Math.max(1, def.rowspan ?? 1);
      const colspan = Math.max(1, def.colspan ?? 1);
      if (ri + rowspan > targetRow && c <= col && col < c + colspan) {
        return true;
      }
    }
  }
  return false;
}

export function normalizeMergedTableBlock(block: MergedTableBlock): MergedTableBlock {
  const columns: TableColumn[] = block.columns?.length
    ? block.columns
    : [{ header: 'Column 1', align: 'left' }];

  const colCount = columns.length;
  const rows = (block.rows ?? []).map(row => padRow(row ?? [], colCount));

  return { ...block, columns, rows };
}

export function updateCell(
  block: MergedTableBlock,
  ri: number,
  ci: number,
  text: string,
): MergedTableBlock {
  const table = normalizeMergedTableBlock(block);
  const rows = table.rows.map(r => [...r]);
  const current = rows[ri]?.[ci];
  if (current === null) return table;

  const def = parseCellDef(current ?? '');
  rows[ri]![ci] = def.rowspan || def.colspan
    ? { ...def, text }
    : text;
  return { ...table, rows };
}

export function mergeCellDown(block: MergedTableBlock, ri: number, ci: number): MergedTableBlock {
  const table = normalizeMergedTableBlock(block);
  const rows = table.rows.map(r => [...r]);
  const raw = rows[ri]?.[ci];
  if (raw === null || raw === undefined) return table;

  const def = parseCellDef(raw);
  const spanEnd = ri + Math.max(1, def.rowspan ?? 1);
  while (rows.length <= spanEnd) {
    rows.push(createEmptyBodyRow({ ...table, rows }, rows.length));
  }

  const newRowspan = Math.max(1, def.rowspan ?? 1) + 1;
  rows[ri]![ci] = { ...def, text: def.text, rowspan: newRowspan };
  rows[spanEnd]![ci] = null;

  return { ...table, rows };
}

export function splitCell(block: MergedTableBlock, ri: number, ci: number): MergedTableBlock {
  const table = normalizeMergedTableBlock(block);
  const rows = table.rows.map(r => [...r]);
  const raw = rows[ri]?.[ci];
  if (raw === null || raw === undefined) return table;

  const def = parseCellDef(raw);
  const rowspan = Math.max(1, def.rowspan ?? 1);
  if (rowspan <= 1) return table;

  rows[ri]![ci] = def.colspan ? { ...def, text: def.text, rowspan: 1 } : def.text;

  for (let r = ri + 1; r < ri + rowspan; r++) {
    if (!rows[r]) rows[r] = createEmptyBodyRow({ ...table, rows }, r);
    rows[r]![ci] = '';
  }

  return { ...table, rows };
}

export function createEmptyBodyRow(block: MergedTableBlock, rowIndex: number): MergedTableCellValue[] {
  const colCount = Math.max(1, block.columns.length);
  return Array.from({ length: colCount }, (_, c) =>
    isSlotCovered(block.rows, rowIndex, c) ? null : '',
  );
}

export function addBodyRow(block: MergedTableBlock): MergedTableBlock {
  const table = normalizeMergedTableBlock(block);
  const newIndex = table.rows.length;
  return {
    ...table,
    rows: [...table.rows, createEmptyBodyRow(table, newIndex)],
  };
}

export function removeBodyRow(block: MergedTableBlock, ri: number): MergedTableBlock {
  const table = normalizeMergedTableBlock(block);
  if (ri < 0 || ri >= table.rows.length) return table;

  // Reindex rowHeights/rowBackgrounds against the full pre-removal row count, then
  // splice the rows array in separately (they must not see the already-shortened array).
  const withoutOverrides = removeRowBackgroundAt(removeRowHeightAt(table, ri), ri);

  const rows = table.rows.filter((_, i) => i !== ri);

  for (let ci = 0; ci < table.columns.length; ci++) {
    for (let r = 0; r < rows.length; r++) {
      const raw = rows[r]?.[ci];
      if (raw === null || raw === undefined) continue;
      const def = parseCellDef(raw);
      const rowspan = Math.max(1, def.rowspan ?? 1);
      if (r + rowspan > rows.length) {
        const nextSpan = Math.max(1, rows.length - r);
        rows[r]![ci] = nextSpan > 1 ? { ...def, rowspan: nextSpan } : def.text;
      }
    }
  }

  return { ...withoutOverrides, rows };
}

export function getCellRowspan(block: MergedTableBlock, ri: number, ci: number): number {
  const raw = block.rows[ri]?.[ci];
  if (raw === null || raw === undefined) return 0;
  return Math.max(1, parseCellDef(raw).rowspan ?? 1);
}
