import {
  buildOcrObject,
  sizeRankFromFont,
  type OcrCell,
  type OcrMatrix,
  type OcrWordBox,
} from '@sorye/types';
import { parseDocumentItems, itemsHaveContent, parseFallbackItemsFromText } from './parse-document';
import {
  annotateWordStyles,
  buildPageLayout,
  layoutFromPlainText,
  layoutHasContent,
} from './layout-matrix';
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

/** Max recall — filter only empty/garbage, not low-confidence tokens. */
const MIN_WORD_CONFIDENCE = 0;

/** PSM modes to try; best results merged (max-quality, slower). */
const PSM_MODES = ['AUTO', 'SPARSE_TEXT', 'SINGLE_COLUMN', 'SPARSE_TEXT_OSD'] as const;

let workerPromise: Promise<Worker> | null = null;
let progressSink: ((pct: number) => void) | null = null;

async function applyMaxQualityParams(
  worker: Worker,
  psm: (typeof PSM_MODES)[number],
): Promise<void> {
  const { PSM } = await import('tesseract.js');
  await worker.setParameters({
    tessedit_pageseg_mode: PSM[psm],
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
    textord_heavy_nr: '1',
    tessedit_enable_bigram_correction: '1',
    load_system_dawg: '1',
    load_freq_dawg: '1',
  });
}

async function getSharedWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      // PDF documents: English + German traineddata (eng+deu).
      const worker = await createWorker(['eng', 'deu'], OEM.DEFAULT, {
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
      await applyMaxQualityParams(worker, 'AUTO');
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

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

function boxOverlap(a: OcrWordBox, b: OcrWordBox): number {
  const overlapX = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const overlapY = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const overlapArea = overlapX * overlapY;
  if (overlapArea <= 0) return 0;
  const areaA = Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0));
  const areaB = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  return overlapArea / Math.min(areaA, areaB);
}

/** Merge words from multiple Tesseract passes — keep best coverage. */
function mergeWordPasses(passes: OcrWordBox[][]): OcrWordBox[] {
  const sorted = [...passes].sort((a, b) => b.length - a.length);
  const merged: OcrWordBox[] = [];

  for (const batch of sorted) {
    for (const word of batch) {
      if (!word.text.trim()) continue;
      const matchIdx = merged.findIndex((m) => boxOverlap(m, word) > 0.4);
      if (matchIdx < 0) {
        merged.push({ ...word });
      } else if (word.confidence > merged[matchIdx]!.confidence) {
        merged[matchIdx] = { ...word };
      }
    }
  }

  return merged;
}

export function collectWordsFromPage(page: TessPage): OcrWordBox[] {
  const out: OcrWordBox[] = [];

  const pushWord = (
    text: string,
    confidence: number,
    bbox: TessBbox,
  ) => {
    const fontSize = Math.max(1, bbox.y1 - bbox.y0);
    out.push({
      text,
      confidence,
      x0: bbox.x0,
      y0: bbox.y0,
      x1: bbox.x1,
      y1: bbox.y1,
      style: {
        fontSize,
        bold: false,
        italic: false,
        sizeRank: 'md',
      },
    });
  };

  if (page.words?.length) {
    for (const w of page.words) {
      if (!w?.text?.trim()) continue;
      pushWord(w.text, w.confidence ?? 0, w.bbox);
    }
    return annotateWordStyles(out);
  }

  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        if (line.words?.length) {
          for (const w of line.words) {
            if (!w?.text?.trim()) continue;
            pushWord(
              w.text,
              w.confidence ?? line.confidence ?? 0,
              w.bbox,
            );
          }
        } else if (line.text?.trim() && line.bbox) {
          pushWord(line.text.trim(), line.confidence ?? 0, line.bbox);
        }
      }
    }
  }

  return annotateWordStyles(out);
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

export function wordsToMatrix(words: OcrWordBox[]): {
  matrix: string[][];
  cells: OcrCell[];
} {
  const usable = words.filter(
    (w) => w.text.trim().length > 0 && w.confidence >= MIN_WORD_CONFIDENCE,
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
      const fontSize =
        cellWords.length > 0
          ? cellWords.reduce(
              (s, w) => s + Math.max(1, w.style?.fontSize ?? w.y1 - w.y0),
              0,
            ) / cellWords.length
          : 12;
      cells.push({
        row: r,
        col: c,
        text,
        confidence,
        words: cellWords,
        style: cellWords[0]?.style ?? {
          fontSize,
          bold: false,
          italic: false,
          sizeRank: sizeRankFromFont(fontSize, fontSize),
        },
      });
    }
    matrix.push(rowTexts);
  }

  return { matrix, cells };
}

function matrixHasContent(matrix: string[][]): boolean {
  return matrix.some((row) => row.some((cell) => cell.trim().length > 0));
}

async function recognizeOnce(
  worker: Worker,
  canvas: HTMLCanvasElement,
  psm: (typeof PSM_MODES)[number],
): Promise<{ page: TessPage; words: OcrWordBox[] }> {
  await applyMaxQualityParams(worker, psm);
  const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const page = result.data as unknown as TessPage;
  return { page, words: collectWordsFromPage(page) };
}

/** Run every PSM mode on both grayscale + binary — merge for max recall. */
async function recognizeMaxQuality(
  worker: Worker,
  canvas: HTMLCanvasElement,
  binaryCanvas: HTMLCanvasElement,
  onPass?: (done: number, total: number) => void,
): Promise<{ page: TessPage; words: OcrWordBox[] }> {
  const canvases = [
    { label: 'enhanced', el: canvas },
    { label: 'binary', el: binaryCanvas },
  ];
  const total = PSM_MODES.length * canvases.length;
  let step = 0;

  const wordPasses: OcrWordBox[][] = [];
  let bestPage: TessPage = { text: '', blocks: [] };
  let bestPageScore = -1;

  for (const { el } of canvases) {
    for (const psm of PSM_MODES) {
      const { page, words } = await recognizeOnce(worker, el, psm);
      wordPasses.push(words);

      const score =
        words.length * 10 +
        (page.text ?? '').split(/\s+/).filter(Boolean).length;
      if (score > bestPageScore) {
        bestPageScore = score;
        bestPage = page;
      }

      step += 1;
      onPass?.(step, total);
    }
  }

  await applyMaxQualityParams(worker, 'AUTO');

  const words = mergeWordPasses(wordPasses);
  return { page: bestPage, words };
}

export async function runOcr(input: {
  canvas: HTMLCanvasElement;
  binaryCanvas: HTMLCanvasElement;
  file: File;
  processedWidth: number;
  processedHeight: number;
  originalBytes: number;
  pdfPage?: number;
  pdfPageCount?: number;
  /** Prefer native PDF text when present — skips Tesseract. */
  textLayerWords?: OcrWordBox[];
  textLayerRaw?: string;
  extractMode?: 'pdf-text' | 'ocr';
  onProgress?: (pct: number) => void;
}): Promise<OcrMatrix> {
  progressSink = input.onProgress ?? null;
  input.onProgress?.(2);

  try {
    let words: OcrWordBox[];
    let rawText: string;
    let meanConfidence: number;

    if (
      input.extractMode === 'pdf-text' &&
      input.textLayerWords &&
      input.textLayerWords.length > 0
    ) {
      input.onProgress?.(40);
      words = input.textLayerWords;
      rawText = (input.textLayerRaw ?? words.map((w) => w.text).join(' ')).trim();
      meanConfidence = 100;
      input.onProgress?.(90);
    } else {
      const worker = await getSharedWorker();
      input.onProgress?.(5);

      const recognized = await recognizeMaxQuality(
        worker,
        input.canvas,
        input.binaryCanvas,
        (done, total) => {
          input.onProgress?.(5 + Math.round((done / total) * 90));
        },
      );

      words = recognized.words;
      rawText = recognized.page.text?.trim() ?? '';
      meanConfidence = recognized.page.confidence ?? 0;
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
    }

    let { matrix, cells } = wordsToMatrix(words);
    if (!matrixHasContent(matrix) && rawText) {
      matrix = textToMatrix(rawText);
      cells = [];
    }

    let layout = buildPageLayout(words, input.processedWidth);
    if (!layoutHasContent(layout)) {
      layout = layoutFromPlainText(rawText);
      if (layoutHasContent(layout) && !matrixHasContent(matrix)) {
        matrix = layout.matrix;
      }
    } else {
      matrix = layout.matrix.map((row) => row.map((cell) => cell));
      cells = layout.rows.flatMap((row, r) =>
        row.cells.map((cell, c) => ({
          row: r,
          col: c,
          text: cell.text,
          confidence: cell.confidence,
          words: cell.words,
          style: cell.style,
        })),
      );
    }

    const items = parseDocumentItems(words, matrix, input.processedWidth);
    const resolvedItems = itemsHaveContent(items)
      ? items
      : parseFallbackItemsFromText(rawText, matrix);

    input.onProgress?.(100);

    return {
      id: `ocr-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      source: {
        fileName: input.file.name || 'document.pdf',
        mimeType: input.file.type || 'application/pdf',
        originalBytes: input.originalBytes,
        processedWidth: input.processedWidth,
        processedHeight: input.processedHeight,
        ...(input.pdfPage != null ? { pdfPage: input.pdfPage } : {}),
        ...(input.pdfPageCount != null
          ? { pdfPageCount: input.pdfPageCount }
          : {}),
        ...(input.extractMode ? { extractMode: input.extractMode } : {}),
      },
      matrix,
      rows: matrix.length,
      cols: matrix[0]?.length ?? 0,
      cells,
      layout,
      items: resolvedItems,
      rawText,
      meanConfidence,
      object: buildOcrObject(matrix),
    };
  } finally {
    progressSink = null;
  }
}
