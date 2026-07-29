import type { MergedTableBlock, TableBlock } from '@protocolio/sdk';

type TableLike = TableBlock | MergedTableBlock;

function normalizedColor(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

export function resolveRowBackground(table: TableLike, rowIndex: number): string | undefined {
  return normalizedColor(table.rowBackgrounds?.[rowIndex]);
}

export function updateRowBackgroundAt<T extends TableLike>(
  table: T,
  rowIndex: number,
  color: string | undefined,
): T {
  const next: (string | undefined)[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    const existing = normalizedColor(table.rowBackgrounds?.[i]);
    if (i === rowIndex) {
      const c = normalizedColor(color);
      if (c) next[i] = c;
    } else if (existing) {
      next[i] = existing;
    }
  }

  const hasAny = next.some(Boolean);
  if (!hasAny) return { ...table, rowBackgrounds: undefined };

  return { ...table, rowBackgrounds: next };
}

export function removeRowBackgroundAt<T extends TableLike>(table: T, rowIndex: number): T {
  if (!table.rowBackgrounds?.length) return table;
  const next: (string | undefined)[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    if (i === rowIndex) continue;
    const c = normalizedColor(table.rowBackgrounds[i]);
    if (c) {
      const newIndex = i < rowIndex ? i : i - 1;
      next[newIndex] = c;
    }
  }
  return { ...table, rowBackgrounds: next.some(Boolean) ? next : undefined };
}
