import type { CSSProperties } from 'react';
import type { MergedTableBlock, TableBlock } from '@protocolio/sdk';

type TableLike = TableBlock | MergedTableBlock;

function positiveHeight(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return undefined;
}

export function resolveEditorRowMinHeight(table: TableLike, rowIndex: number): number | undefined {
  const specific = positiveHeight(table.rowHeights?.[rowIndex]);
  if (specific) return specific;
  return positiveHeight(table.rowHeight);
}

export function updateRowHeightAt<T extends TableLike>(
  table: T,
  rowIndex: number,
  height: number | undefined,
): T {
  const next: number[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    const existing = positiveHeight(table.rowHeights?.[i]);
    if (i === rowIndex) {
      const h = positiveHeight(height);
      if (h) next[i] = h;
    } else if (existing) {
      next[i] = existing;
    }
  }

  const hasAny = next.some(h => h > 0);
  if (!hasAny) return { ...table, rowHeights: undefined };

  return { ...table, rowHeights: next };
}

export function rowHeightStyle(height?: number): CSSProperties | undefined {
  if (height == null || height <= 0) return undefined;
  return { minHeight: height };
}

export function removeRowHeightAt<T extends TableLike>(table: T, rowIndex: number): T {
  if (!table.rowHeights?.length) return table;
  const next: number[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    if (i === rowIndex) continue;
    const h = positiveHeight(table.rowHeights[i]);
    if (h) {
      const newIndex = i < rowIndex ? i : i - 1;
      next[newIndex] = h;
    }
  }
  return { ...table, rowHeights: next.some(h => h > 0) ? next : undefined };
}
