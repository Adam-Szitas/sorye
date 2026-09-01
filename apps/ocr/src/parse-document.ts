import type {
  OcrCellAlign,
  OcrDocumentCell,
  OcrDocumentItem,
  OcrWordBox,
} from '@sorye/types';

interface OcrCellBox {
  text: string;
  x0: number;
  x1: number;
}

interface OcrLine {
  y: number;
  height: number;
  cells: OcrCellBox[];
  words: OcrWordBox[];
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

function lineHasContent(cells: OcrCellBox[]): boolean {
  return cells.some((cell) => cell.text.trim().length > 0);
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

function rowNumericScore(cells: OcrCellBox[]): number {
  const filled = cells.filter((c) => c.text.trim());
  if (filled.length === 0) return 0;
  let sum = 0;
  for (const cell of filled) sum += numericScore(cell.text);
  return sum / filled.length;
}

function rowTextScore(cells: OcrCellBox[]): number {
  const text = cells.map((c) => c.text).join(' ').trim();
  if (!text) return 0;
  const words = text.split(/\s+/).length;
  const letters = (text.match(/[a-zA-ZäöüÄÖÜß]/g) ?? []).length;
  return words + letters * 0.05;
}

function cellBoxFromWords(words: OcrWordBox[]): OcrCellBox {
  const sorted = [...words].sort((a, b) => a.x0 - b.x0);
  return {
    text: sorted
      .map((w) => w.text.trim())
      .filter(Boolean)
      .join(' '),
    x0: Math.min(...sorted.map((w) => w.x0)),
    x1: Math.max(...sorted.map((w) => w.x1)),
  };
}

function wordsToLines(words: OcrWordBox[]): OcrLine[] {
  const usable = words.filter(
    (w) => w.text.trim().length > 0,
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

    const cells = cellBuckets
      .filter((bucket) => bucket.length > 0)
      .map((bucket) => cellBoxFromWords(bucket));

    if (!lineHasContent(cells)) continue;

    const ys = lineWords.map((w) => w.y0);
    const ye = lineWords.map((w) => w.y1);
    lines.push({
      y: rowCenters[i]!,
      height: Math.max(1, Math.max(...ye) - Math.min(...ys)),
      cells,
      words: lineWords,
    });
  }

  return lines.sort((a, b) => a.y - b.y);
}

function isHeaderLikeRow(cells: OcrCellBox[]): boolean {
  if (cells.length < 2) return false;
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

/** Fixed full-width segment grid aligned to the source image. */
function segmentCount(words: OcrWordBox[]): number {
  if (words.length === 0) return 6;
  const widths = words.map((w) => Math.max(1, w.x1 - w.x0));
  const threshold = Math.max(8, median(widths) * 0.5);
  const centers = cluster1D(
    words.map((w) => (w.x0 + w.x1) / 2),
    threshold,
  );
  return Math.min(24, Math.max(centers.length, 4));
}

function segmentIndex(word: OcrWordBox, n: number, imageWidth: number): number {
  if (imageWidth <= 0) return 0;
  const cx = (word.x0 + word.x1) / 2;
  const idx = Math.floor((cx / imageWidth) * n);
  return Math.max(0, Math.min(n - 1, idx));
}

function equalSegmentWidths(n: number): number[] {
  const pct = 100 / n;
  return Array.from({ length: n }, () => pct);
}

function rowToSegmentRow(
  words: OcrWordBox[],
  n: number,
  imageWidth: number,
  kind: 'header' | 'note' | 'amounts',
): OcrDocumentCell[] {
  if (words.length === 0) {
    return Array.from({ length: n }, () => ({
      text: '',
      align: inferCellAlign('', kind),
    }));
  }

  const buckets: OcrWordBox[][] = Array.from({ length: n }, () => []);
  for (const word of words) {
    buckets[segmentIndex(word, n, imageWidth)]!.push(word);
  }

  return buckets.map((bucket) => {
    const text = bucket.length > 0 ? cellBoxFromWords(bucket).text : '';
    return {
      text,
      align: inferCellAlign(text, kind),
    };
  });
}

function inferCellAlign(
  text: string,
  kind: 'header' | 'note' | 'amounts',
): OcrCellAlign {
  const trimmed = text.trim();
  if (!trimmed) return kind === 'amounts' ? 'right' : 'left';
  if (kind === 'amounts' || numericScore(trimmed) >= 0.55) return 'right';
  if (kind === 'header' && trimmed.length <= 18) return 'center';
  return 'left';
}

function itemFromLines(
  lines: OcrLine[],
  imageWidth: number,
): OcrDocumentItem | null {
  const usable = lines.filter(
    (line) => lineHasContent(line.cells) || line.words.length > 0,
  );
  if (usable.length === 0) return null;

  const allWords = usable.flatMap((line) => line.words);
  const n = segmentCount(allWords);
  const columnWidths = equalSegmentWidths(n);
  const width = imageWidth > 0 ? imageWidth : 1;

  const headerLine = usable[0]!;
  const header = rowToSegmentRow(headerLine.words, n, width, 'header');

  const rest = usable.slice(1);
  if (rest.length === 0) {
    return {
      header,
      note: Array.from({ length: n }, () => ({ text: '', align: 'left' as const })),
      amounts: Array.from({ length: n }, () => ({ text: '', align: 'right' as const })),
      columnWidths,
      segmentCount: n,
    };
  }

  if (rest.length === 1) {
    const only = rest[0]!;
    if (rowNumericScore(only.cells) >= 0.55) {
      return {
        header,
        note: Array.from({ length: n }, () => ({ text: '', align: 'left' as const })),
        amounts: rowToSegmentRow(only.words, n, width, 'amounts'),
        columnWidths,
        segmentCount: n,
      };
    }
    return {
      header,
      note: rowToSegmentRow(only.words, n, width, 'note'),
      amounts: Array.from({ length: n }, () => ({ text: '', align: 'right' as const })),
      columnWidths,
      segmentCount: n,
    };
  }

  let noteLine = rest[0]!;
  let amountsLine = rest[rest.length - 1]!;
  let bestNoteScore = -1;
  let bestAmountsScore = -1;

  for (const line of rest) {
    const textScore = rowTextScore(line.cells);
    const numScore = rowNumericScore(line.cells);
    if (textScore > bestNoteScore) {
      bestNoteScore = textScore;
      noteLine = line;
    }
    if (numScore > bestAmountsScore) {
      bestAmountsScore = numScore;
      amountsLine = line;
    }
  }

  if (noteLine === amountsLine && rest.length >= 2) {
    amountsLine = rest[rest.length - 1]!;
    noteLine = rest[0]!;
  }

  return {
    header,
    note: rowToSegmentRow(noteLine.words, n, width, 'note'),
    amounts: rowToSegmentRow(amountsLine.words, n, width, 'amounts'),
    columnWidths,
    segmentCount: n,
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

  const grouped: string[][][] = [];
  for (let i = 0; i < filled.length; i += 3) {
    grouped.push(filled.slice(i, i + 3));
  }
  return grouped;
}

function cellsFromTextRow(
  row: string[],
  kind: 'header' | 'note' | 'amounts',
): OcrDocumentCell[] {
  const filled = row.filter((c) => c.trim());
  if (filled.length === 1 && row.length > 1 && kind === 'note') {
    return [{ text: filled[0]!, colspan: row.length, align: 'left' }];
  }
  return row.map((text) => ({
    text,
    align: inferCellAlign(text, kind),
  }));
}

function padRowToSegments(row: OcrDocumentCell[], n: number): OcrDocumentCell[] {
  if (row.length >= n) return row.slice(0, n);
  return [
    ...row,
    ...Array.from({ length: n - row.length }, () => ({
      text: '',
      align: 'left' as const,
    })),
  ];
}

function itemFromMatrixRows(rows: string[][]): OcrDocumentItem | null {
  const usable = rows.filter(matrixRowHasContent);
  if (usable.length === 0) return null;

  const cols = Math.max(...usable.map((r) => r.length));
  const pad = (row: string[]) =>
    Array.from({ length: cols }, (_, i) => row[i]?.trim() ?? '');
  const columnWidths = equalSegmentWidths(cols);

  const header = padRowToSegments(cellsFromTextRow(pad(usable[0]!), 'header'), cols);
  const rest = usable.slice(1);

  if (rest.length === 0) {
    return {
      header,
      note: Array.from({ length: cols }, () => ({ text: '', align: 'left' as const })),
      amounts: Array.from({ length: cols }, () => ({ text: '', align: 'right' as const })),
      columnWidths,
      segmentCount: cols,
    };
  }

  if (rest.length === 1) {
    const row = pad(rest[0]!);
    if (rowNumericScore(row.map((text) => ({ text, x0: 0, x1: 1 }))) >= 0.55) {
      return {
        header,
        note: Array.from({ length: cols }, () => ({ text: '', align: 'left' as const })),
        amounts: padRowToSegments(cellsFromTextRow(row, 'amounts'), cols),
        columnWidths,
        segmentCount: cols,
      };
    }
    return {
      header,
      note: padRowToSegments(cellsFromTextRow(row, 'note'), cols),
      amounts: Array.from({ length: cols }, () => ({ text: '', align: 'right' as const })),
      columnWidths,
      segmentCount: cols,
    };
  }

  return {
    header,
    note: padRowToSegments(cellsFromTextRow(pad(rest[0]!), 'note'), cols),
    amounts: padRowToSegments(
      cellsFromTextRow(pad(rest[rest.length - 1]!), 'amounts'),
      cols,
    ),
    columnWidths,
    segmentCount: cols,
  };
}

export function parseDocumentItems(
  words: OcrWordBox[],
  matrix: string[][],
  imageWidth = 0,
): OcrDocumentItem[] {
  const lines = wordsToLines(words);
  const lineItems = splitLinesIntoItems(lines)
    .map((group) => itemFromLines(group, imageWidth))
    .filter((item): item is OcrDocumentItem => item !== null);

  if (lineItems.length > 0 && itemsHaveContent(lineItems)) return lineItems;

  return splitMatrixIntoItems(matrix)
    .map(itemFromMatrixRows)
    .filter((item): item is OcrDocumentItem => item !== null);
}

function textLinesFromDocument(rawText: string, matrix: string[][]): string[] {
  const fromText = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (fromText.length > 0) return fromText;

  return matrix
    .map((row) => row.map((cell) => cell.trim()).filter(Boolean).join(' '))
    .filter(Boolean);
}

/** Plain line-by-line view when header/note/amounts layout cannot be inferred. */
export function parseFallbackItemsFromText(
  rawText: string,
  matrix: string[][] = [],
): OcrDocumentItem[] {
  const lines = textLinesFromDocument(rawText, matrix);
  if (lines.length === 0) return [];

  return lines.map((line) => ({
    header: [{ text: line, align: 'left' as const }],
    note: [{ text: '', align: 'left' as const }],
    amounts: [{ text: '', align: 'right' as const }],
    columnWidths: [100],
    segmentCount: 1,
  }));
}

export function itemsHaveContent(items: OcrDocumentItem[]): boolean {
  return items.some(
    (item) =>
      item.header.some((c) => c.text.trim()) ||
      item.note.some((c) => c.text.trim()) ||
      item.amounts.some((c) => c.text.trim()),
  );
}
