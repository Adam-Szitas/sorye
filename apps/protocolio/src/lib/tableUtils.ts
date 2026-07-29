import type { TableBlock, TableColumn } from '@protocolio/sdk';

function sanitizeRowHeights(rowHeights: number[] | undefined, rowCount: number): number[] | undefined {
  if (!rowHeights?.length) return undefined;
  const next: number[] = [];
  for (let i = 0; i < rowCount; i++) {
    const h = rowHeights[i];
    if (typeof h === 'number' && Number.isFinite(h) && h > 0) next[i] = h;
  }
  return next.some(h => h > 0) ? next : undefined;
}

export function normalizeTableBlock(block: TableBlock): TableBlock {
  const columns: TableColumn[] = block.columns?.length
    ? block.columns
    : [{ header: 'Column 1', align: 'left' }];

  const colCount = columns.length;
  const rows = (block.rows ?? []).map(row => {
    const cells = [...row];
    while (cells.length < colCount) cells.push('');
    return cells.slice(0, colCount);
  });

  return {
    ...block,
    columns,
    rows,
    rowHeights: sanitizeRowHeights(block.rowHeights, rows.length),
  };
}
