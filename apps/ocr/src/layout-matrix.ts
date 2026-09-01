import {
  inferBoldFromFontName,
  inferItalicFromFontName,
  sizeRankFromFont,
  type OcrCellAlign,
  type OcrLayoutCell,
  type OcrLayoutRow,
  type OcrPageLayout,
  type OcrRowRole,
  type OcrTextStyle,
  type OcrWordBox,
} from '@sorye/types';

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
  let start = 0;

  // `sorted` is already ordered, so the median of [start, end) is O(1).
  const medianOf = (from: number, to: number): number => {
    const n = to - from;
    const mid = from + Math.floor(n / 2);
    return n % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  };

  for (let i = 1; i < sorted.length; i += 1) {
    if (Math.abs(sorted[i]! - medianOf(start, i)) <= threshold) continue;
    centers.push(medianOf(start, i));
    start = i;
  }
  centers.push(medianOf(start, sorted.length));
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

function wordFontSize(word: OcrWordBox): number {
  if (word.style?.fontSize && word.style.fontSize > 0) return word.style.fontSize;
  return Math.max(1, word.y1 - word.y0);
}

function wordIsBold(word: OcrWordBox): boolean {
  return Boolean(word.style?.bold);
}

function wordIsItalic(word: OcrWordBox): boolean {
  return Boolean(word.style?.italic);
}

/** Merge adjacent PDF runs on the same baseline into coherent tokens. */
export function mergeAdjacentRuns(words: OcrWordBox[]): OcrWordBox[] {
  if (words.length <= 1) return words;

  const sorted = [...words].sort((a, b) => {
    const by = (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2;
    if (Math.abs(by) > 2) return by;
    return a.x0 - b.x0;
  });

  const heights = sorted.map((w) => Math.max(1, w.y1 - w.y0));
  const rowThreshold = Math.max(6, median(heights) * 0.55);
  const out: OcrWordBox[] = [];
  let current = { ...sorted[0]!, style: sorted[0]!.style };

  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!;
    const sameLine =
      Math.abs((current.y0 + current.y1) / 2 - (next.y0 + next.y1) / 2) <=
      rowThreshold;
    const gap = next.x0 - current.x1;
    const size = Math.max(wordFontSize(current), wordFontSize(next));
    const joinGap = size * 0.65;
    const sameStyle =
      wordIsBold(current) === wordIsBold(next) &&
      wordIsItalic(current) === wordIsItalic(next) &&
      Math.abs(wordFontSize(current) - wordFontSize(next)) <= size * 0.2;

    if (sameLine && gap >= -size * 0.15 && gap <= joinGap && sameStyle) {
      const space = gap > size * 0.12 ? ' ' : '';
      current = {
        text: `${current.text}${space}${next.text}`.replace(/\s+/g, ' ').trim(),
        confidence: Math.min(current.confidence, next.confidence),
        x0: Math.min(current.x0, next.x0),
        y0: Math.min(current.y0, next.y0),
        x1: Math.max(current.x1, next.x1),
        y1: Math.max(current.y1, next.y1),
        style: {
          fontSize: Math.max(wordFontSize(current), wordFontSize(next)),
          fontName: current.style?.fontName ?? next.style?.fontName,
          bold: wordIsBold(current) || wordIsBold(next),
          italic: wordIsItalic(current) || wordIsItalic(next),
          sizeRank: current.style?.sizeRank ?? next.style?.sizeRank ?? 'md',
        },
      };
    } else {
      out.push(current);
      current = { ...next, style: next.style };
    }
  }
  out.push(current);
  return out;
}

export function annotateWordStyles(
  words: OcrWordBox[],
  medianFontSize?: number,
): OcrWordBox[] {
  const sizes = words.map(wordFontSize).filter((s) => s > 0);
  const pageMedian = medianFontSize ?? median(sizes) ?? 12;

  return words.map((word) => {
    const fontSize = wordFontSize(word);
    const fontName = word.style?.fontName;
    const bold = word.style?.bold ?? inferBoldFromFontName(fontName);
    const italic = word.style?.italic ?? inferItalicFromFontName(fontName);
    const style: OcrTextStyle = {
      fontSize,
      fontName,
      bold,
      italic,
      sizeRank: sizeRankFromFont(fontSize, pageMedian),
    };
    return { ...word, style };
  });
}

function aggregateStyle(words: OcrWordBox[], pageMedian: number): OcrTextStyle {
  if (words.length === 0) {
    return {
      fontSize: pageMedian,
      bold: false,
      italic: false,
      sizeRank: 'md',
    };
  }

  let boldChars = 0;
  let italicChars = 0;
  let totalChars = 0;
  const sizes: number[] = [];
  let fontName: string | undefined;

  for (const word of words) {
    const len = Math.max(1, word.text.trim().length);
    totalChars += len;
    sizes.push(wordFontSize(word));
    if (wordIsBold(word)) boldChars += len;
    if (wordIsItalic(word)) italicChars += len;
    if (!fontName && word.style?.fontName) fontName = word.style.fontName;
  }

  const fontSize = median(sizes) || pageMedian;
  const bold = boldChars / totalChars >= 0.45;
  const italic = italicChars / totalChars >= 0.45;

  return {
    fontSize,
    fontName,
    bold,
    italic,
    sizeRank: sizeRankFromFont(fontSize, pageMedian),
  };
}

function inferAlign(text: string, style: OcrTextStyle): OcrCellAlign {
  const trimmed = text.trim();
  if (!trimmed) return 'left';
  if (/^[$€£]?\s*[\d.,]+(%)?$/.test(trimmed)) return 'right';
  if (style.sizeRank === 'xl' || style.sizeRank === 'lg') return 'left';
  return 'left';
}

function evaluateRowRole(cells: OcrLayoutCell[], pageMedian: number): OcrRowRole {
  const filled = cells.filter((c) => c.text.trim());
  if (filled.length === 0) return 'empty';

  const boldShare =
    filled.filter((c) => c.style.bold).length / filled.length;
  const avgSize =
    filled.reduce((sum, c) => sum + c.style.fontSize, 0) / filled.length;
  const sizeRatio = avgSize / Math.max(1, pageMedian);
  const mostlyLarge = sizeRatio >= 1.25;
  const veryLarge = sizeRatio >= 1.45;

  if (veryLarge || (mostlyLarge && filled.length <= 3)) return 'title';
  if (boldShare >= 0.55 && filled.length >= 2) return 'header';
  if (boldShare >= 0.55 || mostlyLarge) return 'emphasis';
  return 'body';
}

interface ColumnBand {
  left: number;
  right: number;
  center: number;
}

function isSpanningWord(word: OcrWordBox, pageWidth: number): boolean {
  return word.x1 - word.x0 > pageWidth * 0.42;
}

function wordsToLines(words: OcrWordBox[]): OcrWordBox[][] {
  if (words.length === 0) return [];
  const heights = words.map((w) => Math.max(1, w.y1 - w.y0));
  const threshold = Math.max(7, median(heights) * 0.5);
  const centers = cluster1D(
    words.map((w) => (w.y0 + w.y1) / 2),
    threshold,
  );
  const buckets: OcrWordBox[][] = Array.from({ length: centers.length }, () => []);
  for (const word of words) {
    buckets[nearestIndex((word.y0 + word.y1) / 2, centers)]!.push(word);
  }
  return buckets
    .filter((line) => line.length > 0)
    .map((line) => [...line].sort((a, b) => a.x0 - b.x0));
}

function bandsFromSplits(
  splits: number[],
  left: number,
  right: number,
): ColumnBand[] {
  const edges = [left, ...splits.filter((s) => s > left && s < right), right];
  const unique: number[] = [];
  for (const edge of edges) {
    const prev = unique[unique.length - 1];
    if (prev === undefined || Math.abs(edge - prev) > 4) unique.push(edge);
  }
  if (unique.length < 2) {
    return [{ left, right, center: (left + right) / 2 }];
  }
  const bands: ColumnBand[] = [];
  for (let i = 0; i < unique.length - 1; i += 1) {
    const l = unique[i]!;
    const r = unique[i + 1]!;
    bands.push({ left: l, right: r, center: (l + r) / 2 });
  }
  return bands;
}

/**
 * Column gutters that repeat across many rows. More stable than clustering
 * left edges (right-aligned amounts share a gutter, not a left x).
 */
function splitsFromLineGaps(
  lines: OcrWordBox[][],
  pageWidth: number,
  medianFontSize: number,
): number[] {
  const minGap = Math.max(14, medianFontSize * 0.85);
  const votes: number[] = [];
  let multiTokenLines = 0;

  for (const line of lines) {
    const tokens = line.filter((w) => !isSpanningWord(w, pageWidth));
    if (tokens.length < 2) continue;
    multiTokenLines += 1;
    for (let i = 0; i < tokens.length - 1; i += 1) {
      const left = tokens[i]!;
      const right = tokens[i + 1]!;
      const gap = right.x0 - left.x1;
      if (gap >= minGap) {
        votes.push((left.x1 + right.x0) / 2);
      }
    }
  }

  if (votes.length === 0 || multiTokenLines < 2) return [];

  const clusterPx = Math.max(10, medianFontSize * 0.7);
  const centers = cluster1D(votes, clusterPx);
  const minVotes = Math.max(2, Math.ceil(multiTokenLines * 0.22));
  const counts = new Int32Array(centers.length);
  for (const vote of votes) {
    for (let i = 0; i < centers.length; i += 1) {
      if (Math.abs(vote - centers[i]!) <= clusterPx) counts[i] += 1;
    }
  }
  return centers.filter((_, i) => counts[i]! >= minVotes);
}

/**
 * Fallback: occupancy valleys, ignoring full-width titles that smear gutters.
 */
function splitsFromOccupancy(
  words: OcrWordBox[],
  pageWidth: number,
  medianFontSize: number,
): number[] {
  const compact = words.filter((w) => !isSpanningWord(w, pageWidth));
  if (compact.length === 0) return [];

  const binSize = Math.max(2, Math.round(pageWidth / 220));
  const bins = Math.max(8, Math.ceil(pageWidth / binSize));
  const occupancy = new Float64Array(bins);

  for (const word of compact) {
    const start = Math.max(0, Math.floor(word.x0 / binSize));
    const end = Math.min(
      bins - 1,
      Math.floor(Math.max(word.x0, word.x1 - 0.5) / binSize),
    );
    const weight = Math.max(1, word.x1 - word.x0);
    for (let i = start; i <= end; i += 1) occupancy[i] += weight;
  }

  const smooth = new Float64Array(bins);
  for (let i = 0; i < bins; i += 1) {
    let sum = 0;
    let n = 0;
    for (let k = i - 2; k <= i + 2; k += 1) {
      if (k < 0 || k >= bins) continue;
      sum += occupancy[k]!;
      n += 1;
    }
    smooth[i] = n > 0 ? sum / n : 0;
  }

  const maxOcc = Math.max(...smooth, 1);
  const emptyCut = Math.max(maxOcc * 0.08, medianFontSize * 0.4);
  const minValleyBins = Math.max(2, Math.round(Math.max(12, medianFontSize * 0.65) / binSize));

  const splits: number[] = [];
  let runStart = -1;
  for (let i = 0; i < bins; i += 1) {
    const empty = smooth[i]! <= emptyCut;
    if (empty && runStart < 0) runStart = i;
    if ((!empty || i === bins - 1) && runStart >= 0) {
      const runEnd = empty && i === bins - 1 ? i : i - 1;
      const span = runEnd - runStart + 1;
      if (span >= minValleyBins && runStart > 0 && runEnd < bins - 1) {
        splits.push(((runStart + runEnd + 1) / 2) * binSize);
      }
      runStart = -1;
    }
  }
  return splits;
}

function dropGhostBands(
  bands: ColumnBand[],
  words: OcrWordBox[],
  lines: OcrWordBox[][],
): ColumnBand[] {
  if (bands.length <= 2) return bands;
  const rowCount = lines.length;
  const minHits = Math.max(2, Math.ceil(rowCount * 0.12));
  const kept = bands.filter((band, index) => {
    if (index === 0 || index === bands.length - 1) return true;
    const hits = words.filter((w) => overlapAmount(w, band) > 1).length;
    return hits >= minHits;
  });
  return kept.length > 0 ? kept : bands;
}

function mergeNarrowBands(
  bands: ColumnBand[],
  medianFontSize: number,
): ColumnBand[] {
  const minWidth = Math.max(18, medianFontSize * 1.1);
  const collapsed: ColumnBand[] = [];
  for (const band of bands) {
    const prev = collapsed[collapsed.length - 1];
    const tooNarrow = band.right - band.left < minWidth;
    if (prev && tooNarrow) {
      prev.right = band.right;
      prev.center = (prev.left + prev.right) / 2;
    } else if (!prev && tooNarrow && bands.length > 1) {
      continue;
    } else {
      collapsed.push({ ...band });
    }
  }
  if (collapsed.length === 0) return bands;
  if (
    collapsed.length > 1 &&
    bands[0] &&
    bands[0].right - bands[0].left < minWidth
  ) {
    collapsed[0]!.left = bands[0].left;
    collapsed[0]!.center = (collapsed[0]!.left + collapsed[0]!.right) / 2;
  }
  return collapsed;
}

/**
 * Find column bands from repeating gutters, then occupancy valleys.
 */
function detectColumnBands(
  words: OcrWordBox[],
  imageWidth: number,
  medianFontSize: number,
): ColumnBand[] {
  if (words.length === 0) {
    return [{ left: 0, right: Math.max(1, imageWidth), center: imageWidth / 2 }];
  }

  const contentLeft = Math.min(...words.map((w) => w.x0));
  const contentRight = Math.max(...words.map((w) => w.x1));
  const width = Math.max(imageWidth, contentRight, 1);
  const left = Math.max(0, contentLeft - 2);
  const right = Math.min(width, contentRight + 2);

  const lines = wordsToLines(words);
  let splits = splitsFromLineGaps(lines, width, medianFontSize);
  if (splits.length === 0) {
    splits = splitsFromOccupancy(words, width, medianFontSize);
  }

  let bands = mergeNarrowBands(
    bandsFromSplits(splits, left, right),
    medianFontSize,
  );
  bands = dropGhostBands(bands, words, lines);
  return bands.length > 0
    ? bands
    : [{ left, right, center: (left + right) / 2 }];
}

function overlapAmount(word: OcrWordBox, band: ColumnBand): number {
  const left = Math.max(word.x0, band.left);
  const right = Math.min(word.x1, band.right);
  return Math.max(0, right - left);
}

function bandIndexForWord(word: OcrWordBox, bands: ColumnBand[]): number {
  const pageWidth = Math.max(1, bands[bands.length - 1]!.right - bands[0]!.left);
  if (isSpanningWord(word, pageWidth)) {
    return 0;
  }

  let best = 0;
  let bestScore = -1;
  const mid = (word.x0 + word.x1) / 2;
  const wordW = Math.max(1, word.x1 - word.x0);
  for (let i = 0; i < bands.length; i += 1) {
    const band = bands[i]!;
    const overlap = overlapAmount(word, band);
    const midHit = mid >= band.left && mid < band.right ? 1 : 0;
    const score = overlap * 4 + midHit * wordW;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function columnWidthsFromBands(bands: ColumnBand[], imageWidth: number): number[] {
  if (bands.length === 0) return [100];
  const width = Math.max(imageWidth, bands[bands.length - 1]!.right, 1);
  const widths = bands.map((b) => Math.max(1, b.right - b.left));
  const sum = widths.reduce((a, b) => a + b, 0) || width;
  return widths.map((w) => (w / sum) * 100);
}

/**
 * Build a precise page layout matrix from positioned words + style metadata.
 */
export function buildPageLayout(
  words: OcrWordBox[],
  imageWidth = 0,
): OcrPageLayout {
  const merged = mergeAdjacentRuns(
    words.filter((w) => w.text.trim().length > 0),
  );

  if (merged.length === 0) {
    return {
      rows: [],
      cols: 0,
      columnWidths: [],
      medianFontSize: 12,
      matrix: [],
    };
  }

  const pageMedian =
    median(merged.map(wordFontSize).filter((s) => s > 0)) || 12;
  const ranked = annotateWordStyles(merged, pageMedian);

  const heights = ranked.map((w) => Math.max(1, w.y1 - w.y0));
  // Baseline-oriented row clustering (more stable for mixed sizes).
  const rowThreshold = Math.max(7, median(heights) * 0.5);
  const rowCenters = cluster1D(
    ranked.map((w) => w.y1),
    rowThreshold,
  );
  const width = imageWidth > 0 ? imageWidth : Math.max(...ranked.map((w) => w.x1), 1);
  const bands = detectColumnBands(ranked, width, pageMedian);
  const cols = Math.max(1, bands.length);

  const buckets: OcrWordBox[][][] = Array.from(
    { length: rowCenters.length },
    () => Array.from({ length: cols }, () => []),
  );

  for (const word of ranked) {
    const r = nearestIndex(word.y1, rowCenters);
    const c = bandIndexForWord(word, bands);
    buckets[r]![c]!.push(word);
  }

  const layoutRows: OcrLayoutRow[] = [];
  const matrix: string[][] = [];

  for (let r = 0; r < rowCenters.length; r += 1) {
    const cells: OcrLayoutCell[] = [];
    const rowTexts: string[] = [];

    for (let c = 0; c < cols; c += 1) {
      const cellWords = [...buckets[r]![c]!].sort((a, b) => a.x0 - b.x0);
      const text = cellWords
        .map((w) => w.text.trim())
        .filter(Boolean)
        .join(' ');
      const style = aggregateStyle(cellWords, pageMedian);
      const confidence =
        cellWords.length === 0
          ? 0
          : cellWords.reduce((s, w) => s + w.confidence, 0) / cellWords.length;

      cells.push({
        text,
        align: inferAlign(text, style),
        style,
        confidence,
        words: cellWords,
      });
      rowTexts.push(text);
    }

    const filled = cells.filter((c) => c.text.trim());
    const fontSize =
      filled.length > 0
        ? median(filled.map((c) => c.style.fontSize))
        : pageMedian;
    const boldShare =
      filled.length === 0
        ? 0
        : filled.filter((c) => c.style.bold).length / filled.length;
    const role = evaluateRowRole(cells, pageMedian);

    layoutRows.push({ role, cells, fontSize, boldShare });
    matrix.push(rowTexts);
  }

  return {
    rows: layoutRows,
    cols,
    columnWidths: columnWidthsFromBands(bands, width),
    medianFontSize: pageMedian,
    matrix,
  };
}

export function layoutHasContent(layout: OcrPageLayout): boolean {
  return layout.rows.some((row) =>
    row.cells.some((cell) => cell.text.trim().length > 0),
  );
}

/** Fallback: one cell per non-empty line when geometry is unavailable. */
export function layoutFromPlainText(rawText: string): OcrPageLayout {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      rows: [],
      cols: 0,
      columnWidths: [],
      medianFontSize: 12,
      matrix: [],
    };
  }

  const style: OcrTextStyle = {
    fontSize: 14,
    bold: false,
    italic: false,
    sizeRank: 'md',
  };

  const rows: OcrLayoutRow[] = lines.map((text) => ({
    role: 'body' as const,
    cells: [
      {
        text,
        align: 'left' as const,
        style,
        confidence: 100,
        words: [],
      },
    ],
    fontSize: 14,
    boldShare: 0,
  }));

  return {
    rows,
    cols: 1,
    columnWidths: [100],
    medianFontSize: 14,
    matrix: lines.map((line) => [line]),
  };
}
