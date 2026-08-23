import {
  buildOcrObject,
  type OcrCell,
  type OcrMatrix,
  type OcrWordBox,
} from '@sorye/types';
import { parseDocumentItems } from './parse-document';
import type { Worker } from 'tesseract.js';

interface TessBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TessWord {
  text: string;
  confidence: number;
  bbox: TessBbox;
}

interface TessLine {
  words?: TessWord[];
  text?: string;
  confidence?: number;
  bbox?: TessBbox;
}

interface TessParagraph {
  lines?: TessLine[];
}

interface TessBlock {
  paragraphs?: TessParagraph[];
}

interface TessPage {
  text?: string;
  confidence?: number;
  blocks?: TessBlock[] | null;
  words?: TessWord[];
}

/** Reused across runs — loading eng.wasm + lang data once is the big win. */
let workerPromise: Promise<Worker> | null = null;
let progressSink: ((pct: number) => void) | null = null;

async function getSharedWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        // Keep logger tiny; avoid string work when no UI sink is attached.
        logger: (m) => {
          if (
            progressSink &&
            m.status === 'recognizing text' &&
            typeof m.progress === 'number'
          ) {
            progressSink(Math.round(m.progress * 100));
          }
        },
      });
      // SINGLE_BLOCK is faster than AUTO for scans / phone table photos.
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1',
      });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Prefetch WASM + language data during idle time. */
export function warmOcrEngine(): void {
  const run = () => {
    void getSharedWorker();
  };
  if (typeof window === 'undefined') return;
  const ric = (
    window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number },
      ) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(() => run(), { timeout: 2500 });
  } else {
    globalThis.setTimeout(run, 400);
  }
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

/** Flatten Tesseract v6 block → paragraph → line → word tree. */
export function collectWordsFromPage(page: TessPage): OcrWordBox[] {
  const out: OcrWordBox[] = [];

  if (page.words?.length) {
    for (const w of page.words) {
      if (!w?.text?.trim()) continue;
      out.push({
        text: w.text,
        confidence: w.confidence ?? 0,
        x0: w.bbox.x0,
        y0: w.bbox.y0,
        x1: w.bbox.x1,
        y1: w.bbox.y1,
      });
    }
    return out;
  }

  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        if (line.words?.length) {
          for (const w of line.words) {
            if (!w?.text?.trim()) continue;
            out.push({
              text: w.text,
              confidence: w.confidence ?? line.confidence ?? 0,
              x0: w.bbox.x0,
              y0: w.bbox.y0,
              x1: w.bbox.x1,
              y1: w.bbox.y1,
            });
          }
        } else if (line.text?.trim() && line.bbox) {
          out.push({
            text: line.text.trim(),
            confidence: line.confidence ?? 0,
            x0: line.bbox.x0,
            y0: line.bbox.y0,
            x1: line.bbox.x1,
            y1: line.bbox.y1,
          });
        }
      }
    }
  }

  return out;
}

export function textToMatrix(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [['']];

  if (lines.some((line) => line.includes('\t'))) {
    const rows = lines.map((line) => line.split('\t').map((c) => c.trim()));
    const cols = Math.max(...rows.map((r) => r.length));
    return rows.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ''));
  }

  const spaced = lines.map((line) =>
    line
      .split(/\s{2,}/)
      .map((c) => c.trim())
      .filter(Boolean),
  );
  const multiCol =
    spaced.filter((r) => r.length > 1).length >= Math.ceil(spaced.length / 2);

  if (multiCol) {
    const cols = Math.max(...spaced.map((r) => r.length));
    return spaced.map((r) =>
      Array.from({ length: cols }, (_, i) => r[i] ?? ''),
    );
  }

  return lines.map((line) => [line]);
}

/** Group OCR word boxes into a rectangular matrix (rows × columns). */
export function wordsToMatrix(words: OcrWordBox[]): {
  matrix: string[][];
  cells: OcrCell[];
} {
  const usable = words.filter(
    (w) => w.text.trim().length > 0 && w.confidence >= 20,
  );
  if (usable.length === 0) {
    return { matrix: [['']], cells: [] };
  }

  const heights = usable.map((w) => Math.max(1, w.y1 - w.y0));
  const widths = usable.map((w) => Math.max(1, w.x1 - w.x0));
  const rowThreshold = Math.max(8, median(heights) * 0.7);
  const colThreshold = Math.max(12, median(widths) * 0.85);

  const rowCenters = cluster1D(
    usable.map((w) => (w.y0 + w.y1) / 2),
    rowThreshold,
  );
  const colCenters = cluster1D(
    usable.map((w) => (w.x0 + w.x1) / 2),
    colThreshold,
  );

  const rows = rowCenters.length;
  const cols = Math.max(1, colCenters.length);
  const buckets: OcrWordBox[][][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => []),
  );

  for (const word of usable) {
    const r = nearestIndex((word.y0 + word.y1) / 2, rowCenters);
    const c = nearestIndex((word.x0 + word.x1) / 2, colCenters);
    buckets[r]![c]!.push(word);
  }

  const matrix: string[][] = [];
  const cells: OcrCell[] = [];

  for (let r = 0; r < rows; r += 1) {
    const rowTexts: string[] = [];
    for (let c = 0; c < cols; c += 1) {
      const cellWords = buckets[r]![c]!;
      cellWords.sort((a, b) => a.x0 - b.x0);
      const text = cellWords
        .map((w) => w.text.trim())
        .filter(Boolean)
        .join(' ');
      let confidence = 0;
      if (cellWords.length > 0) {
        let sum = 0;
        for (const w of cellWords) sum += w.confidence;
        confidence = sum / cellWords.length;
      }
      rowTexts.push(text);
      // Skip storing per-word arrays — cuts memory on large tables.
      cells.push({
        row: r,
        col: c,
        text,
        confidence,
        words: [],
      });
    }
    matrix.push(rowTexts);
  }

  return { matrix, cells };
}

function matrixHasContent(matrix: string[][]): boolean {
  return matrix.some((row) => row.some((cell) => cell.trim().length > 0));
}

export async function runOcr(input: {
  canvas: HTMLCanvasElement;
  file: File;
  processedWidth: number;
  processedHeight: number;
  originalBytes: number;
  onProgress?: (pct: number) => void;
}): Promise<OcrMatrix> {
  progressSink = input.onProgress ?? null;
  input.onProgress?.(2);

  try {
    const worker = await getSharedWorker();
    input.onProgress?.(8);

    // Only text + blocks — skip tsv/hocr/pdf (expensive serializations).
    const result = await worker.recognize(
      input.canvas,
      {},
      { text: true, blocks: true },
    );

    const page = result.data as unknown as TessPage;
    const rawText = page.text?.trim() ?? '';
    const words = collectWordsFromPage(page);

    let { matrix, cells } = wordsToMatrix(words);
    if (!matrixHasContent(matrix) && rawText) {
      matrix = textToMatrix(rawText);
      cells = [];
    }

    const items = parseDocumentItems(words, matrix);

    let meanConfidence = page.confidence ?? 0;
    if (words.length > 0) {
      let sum = 0;
      let n = 0;
      for (const w of words) {
        if (w.confidence > 0) {
          sum += w.confidence;
          n += 1;
        }
      }
      if (n > 0) meanConfidence = sum / n;
    }

    input.onProgress?.(100);

    return {
      id: `ocr-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      source: {
        fileName: input.file.name || 'capture.jpg',
        mimeType: input.file.type || 'image/jpeg',
        originalBytes: input.originalBytes,
        processedWidth: input.processedWidth,
        processedHeight: input.processedHeight,
      },
      matrix,
      rows: matrix.length,
      cols: matrix[0]?.length ?? 0,
      cells,
      items,
      rawText,
      meanConfidence,
      object: buildOcrObject(matrix),
    };
  } finally {
    progressSink = null;
  }
}
