/**
 * Kept in sync with `OCR_IMAGE_MARKER` in `packages/types/src/ocr-ai.ts`.
 * Page rows are the visible line text. They are not math scopes.
 */
const OCR_IMAGE_MARKER = '[IMAGE]';

/**
 * Positioned text in top-left coordinates (y grows downward).
 * `math` is ignored. Storage does not classify glyphs as equations.
 */
export interface LaidRun {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  math?: boolean;
}

/** A figure, logo, or photo. Stored as `[IMAGE]` when it has no text. */
export interface LaidFigure {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Cluster {
  anchor: number;
  y: number;
  height: number;
  runs: LaidRun[];
  figures: LaidFigure[];
}

interface Piece {
  x: number;
  end: number;
  index: number;
  text: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/** Keep the characters on the page. Spaces stay spaces. */
function visibleText(text: string): string {
  return text
    .replace(/\u00ad/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r?\n/g, ' ');
}

function clusterByBaseline(runs: LaidRun[], threshold: number): Cluster[] {
  const sorted = [...runs].sort(
    (a, b) => a.y + a.height - (b.y + b.height) || a.x - b.x,
  );
  const clusters: Cluster[] = [];
  for (const run of sorted) {
    const baseline = run.y + Math.max(1, run.height);
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(baseline - last.anchor) > threshold) {
      clusters.push({
        anchor: baseline,
        y: run.y,
        height: Math.max(1, run.height),
        runs: [run],
        figures: [],
      });
      continue;
    }
    last.runs.push(run);
    const top = Math.min(last.y, run.y);
    const bottom = Math.max(last.y + last.height, run.y + run.height);
    last.y = top;
    last.height = Math.max(1, bottom - top);
  }
  return clusters;
}

function attachRun(cluster: Cluster, run: LaidRun): void {
  cluster.runs.push(run);
  const top = Math.min(cluster.y, run.y);
  const bottom = Math.max(cluster.y + cluster.height, run.y + run.height);
  cluster.y = top;
  cluster.height = Math.max(1, bottom - top);
}

function buildClusters(runs: LaidRun[], figures: LaidFigure[]): Cluster[] {
  const heights = runs.map((run) => Math.max(1, run.height));
  const medianH = median(heights) || 12;
  const threshold = Math.max(4, medianH * 0.85);
  const body = runs.filter((run) => run.height >= medianH * 0.75);
  const small = runs.filter((run) => run.height < medianH * 0.75);
  const clusters =
    body.length > 0
      ? clusterByBaseline(body, threshold)
      : clusterByBaseline(runs, threshold);

  if (body.length > 0) {
    const limit = threshold * 1.35;
    for (const run of small) {
      const baseline = run.y + Math.max(1, run.height);
      let best: Cluster | null = null;
      let bestDist = Infinity;
      for (const cluster of clusters) {
        const dist = Math.abs(baseline - cluster.anchor);
        if (dist < bestDist) {
          bestDist = dist;
          best = cluster;
        }
      }
      if (best && bestDist <= limit) {
        attachRun(best, run);
      } else {
        clusters.push({
          anchor: baseline,
          y: run.y,
          height: Math.max(1, run.height),
          runs: [run],
          figures: [],
        });
      }
    }
  }

  for (const figure of figures) {
    const center = figure.y + figure.height / 2;
    let best: Cluster | null = null;
    let bestDist = Infinity;
    for (const cluster of clusters) {
      const clusterCenter = cluster.y + cluster.height / 2;
      const dist = Math.abs(center - clusterCenter);
      const reaches =
        center >= cluster.y - medianH * 0.35 &&
        center <= cluster.y + cluster.height + medianH * 0.35;
      if (reaches && dist < bestDist) {
        bestDist = dist;
        best = cluster;
      }
    }
    if (best) {
      best.figures.push(figure);
      const top = Math.min(best.y, figure.y);
      const bottom = Math.max(best.y + best.height, figure.y + figure.height);
      best.y = top;
      best.height = Math.max(1, bottom - top);
    } else {
      clusters.push({
        anchor: figure.y + figure.height,
        y: figure.y,
        height: Math.max(1, figure.height),
        runs: [],
        figures: [figure],
      });
    }
  }

  clusters.sort((a, b) => a.y - b.y || a.anchor - b.anchor);
  return clusters;
}

function renderCluster(cluster: Cluster): string {
  const pieces: Piece[] = [];
  let index = 0;
  for (const run of cluster.runs) {
    const text = visibleText(run.text);
    if (!text) continue;
    pieces.push({
      x: run.x,
      end: run.x + Math.max(run.width, 0),
      index,
      text,
    });
    index += 1;
  }
  for (const figure of cluster.figures) {
    pieces.push({
      x: figure.x,
      end: figure.x + figure.width,
      index,
      text: OCR_IMAGE_MARKER,
    });
    index += 1;
  }
  pieces.sort((a, b) => a.x - b.x || a.index - b.index);

  let out = '';
  let cursor = Number.NEGATIVE_INFINITY;
  for (const piece of pieces) {
    if (out.length > 0) {
      const separated = piece.x > cursor + 0.5;
      const marker =
        piece.text === OCR_IMAGE_MARKER || out.endsWith(OCR_IMAGE_MARKER);
      const leftSpace = /\s$/.test(out);
      const rightSpace = /^\s/.test(piece.text);
      if (!leftSpace && !rightSpace && (separated || marker)) out += ' ';
    }
    out += piece.text;
    cursor = Math.max(cursor, piece.end);
  }
  return out;
}

function keepRow(row: string): boolean {
  if (row.includes(OCR_IMAGE_MARKER)) return true;
  return row.replace(/\s/g, '').length > 0;
}

/**
 * One string per visual line, in top-to-bottom order.
 * Run text is copied as it appears, including spaces. A figure with no
 * text becomes `[IMAGE]`. Lines are not merged, summed, or tagged as math.
 */
export function layoutToRows(runs: LaidRun[], figures: LaidFigure[]): string[] {
  const prepared = runs
    .filter((run) => visibleText(run.text).replace(/\s/g, '').length > 0)
    .map((run) => ({
      ...run,
      text: visibleText(run.text),
      height: Math.max(1, run.height),
      width: Math.max(0.5, run.width),
    }));

  const visibleFigures = figures.filter(
    (figure) => figure.width >= 1 && figure.height >= 1,
  );
  if (prepared.length === 0 && visibleFigures.length === 0) return [];

  const rows: string[] = [];
  for (const cluster of buildClusters(prepared, visibleFigures)) {
    const row = renderCluster(cluster);
    if (keepRow(row)) rows.push(row);
  }
  return rows;
}
