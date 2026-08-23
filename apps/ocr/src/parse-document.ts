import type { OcrDocumentItem, OcrWordBox } from '@sorye/types';

interface OcrLine {
  y: number;
  height: number;
  cells: string[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function cluster1D(positions: number[], threshold: number): number[] {
  if (positions.length === 0) return [];
  const sorted = [...positions].sort((a, b) => a - b);
  const centers: number[] = [];
  let bucket: number[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i += 1) {
    const value = sorted[i]!;
    const center = median(bucket);
    if (Math.abs(value - center) <= threshold) {
      bucket.push(value);
    } else {
      centers.push(median(bucket));
      bucket = [value];
    }
  }
  centers.push(median(bucket));
  return centers;
}

function nearestIndex(value: number, centers: number[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < centers.length; i += 1) {
    const dist = Math.abs(value - centers[i]!);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function lineHasContent(cells: string[]): boolean {
  return cells.some((cell) => cell.trim().length > 0);
}

function padRow(row: string[], cols: number): string[] {
  return Array.from({ length: cols }, (_, i) => row[i]?.trim() ?? '');
}

function numericScore(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (/^[$€£]?\s*[\d.,]+(%)?$/.test(trimmed)) return 1;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return 0;
  const numeric = tokens.filter((t) => /[\d]/.test(t)).length;
  return numeric / tokens.length;
}

function rowNumericScore(cells: string[]): number {
  const filled = cells.filter((c) => c.trim());
  if (filled.length === 0) return 0;
  let sum = 0;
  for (const cell of filled) sum += numericScore(cell);
  return sum / filled.length;
}

function rowTextScore(cells: string[]): number {
  const text = cells.join(' ').trim();
  if (!text) return 0;
  const words = text.split(/\s+/).length;
  const letters = (text.match(/[a-zA-Z]/g) ?? []).length;
  return words + letters * 0.05;
}

function wordsToLines(words: OcrWordBox[]): OcrLine[] {
  const usable = words.filter(
    (w) => w.text.trim().length > 0 && w.confidence >= 20,
  );
  if (usable.length === 0) return [];

  const heights = usable.map((w) => Math.max(1, w.y1 - w.y0));
  const widths = usable.map((w) => Math.max(1, w.x1 - w.x0));
  const rowThreshold = Math.max(8, median(heights) * 0.65);
  const colThreshold = Math.max(10, median(widths) * 0.75);

  const rowCenters = cluster1D(
    usable.map((w) => (w.y0 + w.y1) / 2),
    rowThreshold,
  );

  const lineBuckets: OcrWordBox[][] = Array.from(
    { length: rowCenters.length },
    () => [],
  );

  for (const word of usable) {
    const r = nearestIndex((word.y0 + word.y1) / 2, rowCenters);
    lineBuckets[r]!.push(word);
  }

  const lines: OcrLine[] = [];

  for (let i = 0; i < lineBuckets.length; i += 1) {
    const lineWords = lineBuckets[i]!;
    if (lineWords.length === 0) continue;

    const colCenters = cluster1D(
      lineWords.map((w) => (w.x0 + w.x1) / 2),
      colThreshold,
    );
    const cols = Math.max(1, colCenters.length);
    const cellBuckets: OcrWordBox[][] = Array.from({ length: cols }, () => []);

    for (const word of lineWords) {
      const c = nearestIndex((word.x0 + word.x1) / 2, colCenters);
      cellBuckets[c]!.push(word);
    }

    const cells = cellBuckets.map((bucket) =>
      bucket
        .sort((a, b) => a.x0 - b.x0)
        .map((w) => w.text.trim())
        .filter(Boolean)
        .join(' '),
    );

    if (!lineHasContent(cells)) continue;

    const ys = lineWords.map((w) => w.y0);
    const ye = lineWords.map((w) => w.y1);
    lines.push({
      y: rowCenters[i]!,
      height: Math.max(1, Math.max(...ye) - Math.min(...ys)),
      cells,
    });
  }

  return lines.sort((a, b) => a.y - b.y);
}

function isHeaderLikeRow(cells: string[]): boolean {
  const filled = cells.filter((c) => c.trim());
  if (filled.length < 2) return false;
  return rowNumericScore(cells) < 0.35;
}

function splitLinesIntoItems(lines: OcrLine[]): OcrLine[][] {
  if (lines.length === 0) return [];
  if (lines.length === 1) return [lines];

  const heights = lines.map((l) => l.height);
  const medianHeight = Math.max(8, median(heights));
  const gapThreshold = medianHeight * 2.2;

  const items: OcrLine[][] = [];
  let current: OcrLine[] = [lines[0]!];

  for (let i = 1; i < lines.length; i += 1) {
    const prev = lines[i - 1]!;
    const next = lines[i]!;
    const gap = next.y - prev.y - prev.height * 0.5;
    const newItemByGap = gap > gapThreshold;
    const newItemByPattern =
      current.length >= 3 &&
      isHeaderLikeRow(next.cells) &&
      rowNumericScore(prev.cells) >= 0.4;

    if (newItemByGap || newItemByPattern) {
      items.push(current);
      current = [next];
    } else {
      current.push(next);
    }
  }
  items.push(current);
  return items;
}

function itemFromLines(lines: OcrLine[]): OcrDocumentItem | null {
  const rows = lines
    .map((line) => line.cells.map((c) => c.trim()))
    .filter(lineHasContent);
  if (rows.length === 0) return null;

  const header = rows[0]!;
  const rest = rows.slice(1);

  if (rest.length === 0) {
    const cols = header.length;
    return {
      header: padRow(header, cols),
      note: padRow([], cols),
      amounts: padRow([], cols),
    };
  }

  if (rest.length === 1) {
    const cols = Math.max(header.length, rest[0]!.length);
    const only = rest[0]!;
    if (rowNumericScore(only) >= 0.55) {
      return {
        header: padRow(header, cols),
        note: padRow([], cols),
        amounts: padRow(only, cols),
      };
    }
    return {
      header: padRow(header, cols),
      note: padRow(only, cols),
      amounts: padRow([], cols),
    };
  }

  let noteIdx = 0;
  let amountsIdx = rest.length - 1;

  if (rest.length >= 2) {
    let bestNote = 0;
    let bestNoteScore = -1;
    let bestAmounts = rest.length - 1;
    let bestAmountsScore = -1;

    for (let i = 0; i < rest.length; i += 1) {
      const textScore = rowTextScore(rest[i]!);
      const numScore = rowNumericScore(rest[i]!);
      if (textScore > bestNoteScore) {
        bestNoteScore = textScore;
        bestNote = i;
      }
      if (numScore > bestAmountsScore) {
        bestAmountsScore = numScore;
        bestAmounts = i;
      }
    }

    noteIdx = bestNote;
    amountsIdx = bestAmounts;
    if (noteIdx === amountsIdx && rest.length >= 2) {
      amountsIdx = noteIdx === rest.length - 1 ? rest.length - 2 : rest.length - 1;
    }
  }

  const cols = Math.max(
    header.length,
    rest[noteIdx]?.length ?? 0,
    rest[amountsIdx]?.length ?? 0,
    ...rest.map((r) => r.length),
  );

  return {
    header: padRow(header, cols),
    note: padRow(rest[noteIdx] ?? [], cols),
    amounts: padRow(rest[amountsIdx] ?? [], cols),
  };
}

function matrixRowHasContent(row: string[]): boolean {
  return row.some((cell) => cell.trim().length > 0);
}

function splitMatrixIntoItems(matrix: string[][]): string[][][] {
  const chunks: string[][][] = [];
  let current: string[][] = [];

  for (const row of matrix) {
    if (!matrixRowHasContent(row)) {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
      }
      continue;
    }
    current.push(row.map((c) => c.trim()));
  }
  if (current.length > 0) chunks.push(current);

  if (chunks.length > 0) return chunks;

  const filled = matrix.filter(matrixRowHasContent);
  if (filled.length <= 3) return [filled];

  const itemSize = 3;
  const grouped: string[][][] = [];
  for (let i = 0; i < filled.length; i += itemSize) {
    grouped.push(filled.slice(i, i + itemSize));
  }
  return grouped;
}

function itemFromMatrixRows(rows: string[][]): OcrDocumentItem | null {
  const lines: OcrLine[] = rows.map((cells, i) => ({
    y: i,
    height: 1,
    cells,
  }));
  return itemFromLines(lines);
}

export function parseDocumentItems(
  words: OcrWordBox[],
  matrix: string[][],
): OcrDocumentItem[] {
  const lines = wordsToLines(words);
  const lineItems = splitLinesIntoItems(lines)
    .map(itemFromLines)
    .filter((item): item is OcrDocumentItem => item !== null);

  if (lineItems.length > 0) return lineItems;

  return splitMatrixIntoItems(matrix)
    .map(itemFromMatrixRows)
    .filter((item): item is OcrDocumentItem => item !== null);
}

export function itemsHaveContent(items: OcrDocumentItem[]): boolean {
  return items.some(
    (item) =>
      item.header.some((c) => c.trim()) ||
      item.note.some((c) => c.trim()) ||
      item.amounts.some((c) => c.trim()),
  );
}
