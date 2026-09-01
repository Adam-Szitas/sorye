import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  inferBoldFromFontName,
  inferItalicFromFontName,
  type OcrWordBox,
} from '@sorye/types';
import { enhanceCanvas, type PreparedImage } from './prepare-image';

GlobalWorkerOptions.workerSrc = pdfjsWorker;

/** PDF user units are 72 DPI; render at 300 DPI for OCR fidelity. */
export const PDF_TARGET_DPI = 300;
/** Cap long edge so huge pages stay within canvas/memory limits. */
export const PDF_MAX_EDGE = 4200;
/** Minimum characters of real text before we trust the PDF text layer. */
const MIN_TEXT_LAYER_CHARS = 24;

let cachedPdfKey: string | null = null;
let cachedPdfDoc: PDFDocumentProxy | null = null;

function pdfCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function clearPdfCache(): void {
  cachedPdfKey = null;
  cachedPdfDoc = null;
}

async function loadPdfDocument(file: File): Promise<PDFDocumentProxy> {
  const key = pdfCacheKey(file);
  if (cachedPdfKey === key && cachedPdfDoc) return cachedPdfDoc;

  const data = new Uint8Array(await file.arrayBuffer());
  cachedPdfDoc = await getDocument({
    data,
    // Prefer accuracy over speed for document reading.
    disableFontFace: false,
    useSystemFonts: true,
  }).promise;
  cachedPdfKey = key;
  return cachedPdfDoc;
}

export async function getPdfPageCount(file: File): Promise<number> {
  const pdf = await loadPdfDocument(file);
  return pdf.numPages;
}

export function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' ||
    file.name.toLowerCase().endsWith('.pdf')
  );
}

export function computePdfRenderScale(
  pageWidthPt: number,
  pageHeightPt: number,
): number {
  const dpiScale = PDF_TARGET_DPI / 72;
  const longEdge = Math.max(pageWidthPt, pageHeightPt) * dpiScale;
  if (longEdge <= PDF_MAX_EDGE) return dpiScale;
  return (PDF_MAX_EDGE / Math.max(pageWidthPt, pageHeightPt));
}

export interface PreparedPdfPage extends PreparedImage {
  pdfPage: number;
  pdfPageCount: number;
  /** Native PDF text with layout — prefer over OCR when present. */
  textLayerWords?: OcrWordBox[];
  textLayerRaw?: string;
  /** How this page will be / was read. */
  extractMode: 'pdf-text' | 'ocr';
}

interface TextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
  fontName?: string;
}

/**
 * Convert PDF text-layer items into word boxes in the same pixel space as the
 * rendered canvas (origin top-left), including font style metadata.
 */
export async function extractPdfTextLayer(
  pdfPage: PDFPageProxy,
  viewport: ReturnType<PDFPageProxy['getViewport']>,
): Promise<{ words: OcrWordBox[]; rawText: string }> {
  const content = await pdfPage.getTextContent();
  const words: OcrWordBox[] = [];
  const lines: string[] = [];
  let line = '';

  for (const item of content.items as TextItem[]) {
    const str = (item.str ?? '').replace(/\s+/g, ' ').trim();
    const transform = item.transform;
    if (!str || !transform || transform.length < 6) {
      if (item.hasEOL && line) {
        lines.push(line);
        line = '';
      }
      continue;
    }

    const [, , , , e, f] = transform;
    const [vx, vy] = viewport.convertToViewportPoint(e!, f!);
    const fontSize =
      Math.hypot(transform[2] ?? 0, transform[3] ?? 0) * viewport.scale ||
      Math.abs(transform[0] ?? 10) * viewport.scale ||
      12;
    const width = Math.max(
      (item.width ?? 0) * viewport.scale,
      str.length * fontSize * 0.45,
    );
    const height = Math.max((item.height ?? 0) * viewport.scale, fontSize);
    const x0 = vx;
    const y1 = vy;
    const y0 = y1 - height;
    const x1 = x0 + width;
    const fontName = item.fontName;

    words.push({
      text: str,
      confidence: 100,
      x0,
      y0,
      x1,
      y1,
      style: {
        fontSize,
        fontName,
        bold: inferBoldFromFontName(fontName),
        italic: inferItalicFromFontName(fontName),
        sizeRank: 'md',
      },
    });

    line = line ? `${line} ${str}` : str;
    if (item.hasEOL) {
      lines.push(line);
      line = '';
    }
  }

  if (line) lines.push(line);

  const rawText =
    lines.join('\n').trim() ||
    words
      .map((w) => w.text)
      .join(' ')
      .trim();

  return { words, rawText };
}

function textLayerIsUsable(rawText: string, words: OcrWordBox[]): boolean {
  const letters = (rawText.match(/[a-zA-ZäöüÄÖÜß0-9]/g) ?? []).length;
  return letters >= MIN_TEXT_LAYER_CHARS && words.length > 0;
}

export async function preparePdfPage(
  file: File,
  pageNumber: number,
): Promise<PreparedPdfPage> {
  if (!isPdfFile(file)) {
    throw new Error('Only PDF documents are supported.');
  }

  const pdf = await loadPdfDocument(file);
  const pageCount = pdf.numPages;
  const page = Math.min(Math.max(1, pageNumber), pageCount);
  const pdfPage = await pdf.getPage(page);

  const base = pdfPage.getViewport({ scale: 1 });
  const scale = computePdfRenderScale(base.width, base.height);
  const viewport = pdfPage.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas unavailable');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await pdfPage.render({
    canvasContext: ctx,
    viewport,
  }).promise;

  const { words, rawText } = await extractPdfTextLayer(pdfPage, viewport);
  const useTextLayer = textLayerIsUsable(rawText, words);

  // Text-layer pages still need a light preview; OCR pages need enhance+binary.
  if (useTextLayer) {
    return {
      canvas,
      binaryCanvas: canvas,
      width: canvas.width,
      height: canvas.height,
      originalBytes: file.size,
      pdfPage: page,
      pdfPageCount: pageCount,
      textLayerWords: words,
      textLayerRaw: rawText,
      extractMode: 'pdf-text',
    };
  }

  const { canvas: enhanced, binaryCanvas } = enhanceCanvas(canvas);
  return {
    canvas: enhanced,
    binaryCanvas,
    width: enhanced.width,
    height: enhanced.height,
    originalBytes: file.size,
    pdfPage: page,
    pdfPageCount: pageCount,
    extractMode: 'ocr',
  };
}

/** @deprecated Prefer preparePdfPage — kept name for call sites during transition. */
export async function renderPdfPage(
  file: File,
  pageNumber: number,
): Promise<{
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  pageCount: number;
  page: number;
}> {
  const prepared = await preparePdfPage(file, pageNumber);
  return {
    canvas: prepared.canvas,
    width: prepared.width,
    height: prepared.height,
    pageCount: prepared.pdfPageCount,
    page: prepared.pdfPage,
  };
}
