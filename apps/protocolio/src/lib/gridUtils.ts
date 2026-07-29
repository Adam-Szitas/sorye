import type { GridBlock, GridCell, GridRowSettings, Block } from '@protocolio/sdk';

export function emptyCell(): GridCell {
  return { blocks: [] };
}

export function createEmptyGrid(rows: number, columns: number): GridCell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => emptyCell())
  );
}

export function resizeGridCells(
  cells: GridCell[][],
  rows: number,
  columns: number,
): GridCell[][] {
  const next = createEmptyGrid(rows, columns);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      if (cells[r]?.[c]) next[r]![c] = cells[r]![c]!;
    }
  }
  return next;
}

export function resizeRowSettings(
  rowSettings: GridRowSettings[] | undefined,
  rows: number,
): GridRowSettings[] {
  const next: GridRowSettings[] = [];
  for (let r = 0; r < rows; r++) {
    next.push(rowSettings?.[r] ?? {});
  }
  return next;
}

export function normalizeGridBlock(block: GridBlock): GridBlock {
  const rows = Math.max(1, block.rows);
  const columns = Math.max(1, block.columns);
  return {
    ...block,
    rows,
    columns,
    cells: resizeGridCells(block.cells ?? [], rows, columns),
    rowSettings: resizeRowSettings(block.rowSettings, rows),
  };
}

export function defaultGridBlock(): GridBlock {
  const cells = createEmptyGrid(1, 2);
  cells[0]![0] = {
    blocks: [{ type: 'image', src: '', width: 80, align: 'center' }],
    align: 'center',
    valign: 'center',
  };
  cells[0]![1] = {
    blocks: [{ type: 'text', content: 'Text next to image' }],
    align: 'left',
    valign: 'center',
  };

  return {
    type: 'grid',
    rows: 1,
    columns: 2,
    gap: 12,
    align: 'left',
    valign: 'center',
    cells,
  };
}

export function setCellContent(cell: GridCell, kind: 'empty' | 'text' | 'image'): GridCell {
  if (kind === 'empty') return { ...cell, blocks: [] };
  if (kind === 'text') {
    return { ...cell, blocks: [{ type: 'text', content: 'Cell text' }] };
  }
  return { ...cell, blocks: [{ type: 'image', src: '', width: 80, align: cell.align ?? 'center' }] };
}

export function getCellContentKind(cell: GridCell): 'empty' | 'text' | 'image' {
  const block = cell.blocks[0];
  if (!block) return 'empty';
  if (block.type === 'text') return 'text';
  if (block.type === 'image') return 'image';
  return 'empty';
}

export function updateCellBlock(cell: GridCell, block: Block): GridCell {
  return { ...cell, blocks: [block] };
}
