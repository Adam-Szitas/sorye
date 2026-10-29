import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { OcrAiPage } from '@sorye/types';
import { layoutToRows, type LaidFigure, type LaidRun } from './rows';
import { MAX_OCR_PAGES } from '../security-limits';

const pdfRequire = createRequire(import.meta.url);

interface PdfjsLegacy {
  getDocument: (src: Record<string, unknown>) => {
    promise: Promise<PdfDocument>;
  };
  GlobalWorkerOptions: { workerSrc: string };
  OPS: Record<string, number>;
  Util: { transform: (m1: number[], m2: number[]) => number[] };
}

interface PdfDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
}

interface PdfViewport {
  convertToViewportPoint: (x: number, y: number) => [number, number];
}

interface PdfPage {
  cleanup: () => void;
  getViewport: (options: { scale: number }) => PdfViewport;
  getTextContent: () => Promise<{
    items: unknown[];
    styles?: Record<string, { fontFamily?: string }>;
  }>;
  getOperatorList: () => Promise<{
    fnArray: number[];
    argsArray: unknown[];
  }>;
}

interface TextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
}

const IMAGE_OP_NAMES = [
  'paintImageXObject',
  'paintInlineImageXObject',
  'paintInlineImageXObjectGroup',
  'paintImageXObjectRepeat',
  'paintImageMaskXObject',
  'paintImageMaskXObjectGroup',
  'paintImageMaskXObjectRepeat',
] as const;

let pdfjsPromise: Promise<PdfjsLegacy> | null = null;

function loadPdfjs(): Promise<PdfjsLegacy> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      const pdfjs = mod as unknown as PdfjsLegacy;
      const workerPath = pdfRequire.resolve(
        'pdfjs-dist/legacy/build/pdf.worker.mjs',
      );
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

function asTextItem(value: unknown): TextItem | null {
  if (!value || typeof value !== 'object') return null;
  if (!('str' in value)) return null;
  return value as TextItem;
}

function boxFromCtm(
  ctm: number[],
  convert: (x: number, y: number) => [number, number],
): LaidFigure | null {
  if (ctm.length < 6) return null;
  const [a, b, c, d, e, f] = ctm;
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    e === undefined ||
    f === undefined
  ) {
    return null;
  }
  const corners: Array<[number, number]> = [
    [e, f],
    [a + e, b + f],
    [c + e, d + f],
    [a + c + e, b + d + f],
  ];
  const points = corners.map(([x, y]) => convert(x, y));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < 8 && height < 8) return null;
  return { x, y, width, height };
}

function figuresOnPage(pageOps: {
  fnArray: number[];
  argsArray: unknown[];
  pdfjs: PdfjsLegacy;
  viewport: PdfViewport;
}): LaidFigure[] {
  const { fnArray, argsArray, pdfjs, viewport } = pageOps;
  const imageOps = new Set(
    IMAGE_OP_NAMES.map((name) => pdfjs.OPS[name]).filter(
      (code): code is number => typeof code === 'number',
    ),
  );
  const save = pdfjs.OPS.save;
  const restore = pdfjs.OPS.restore;
  const transform = pdfjs.OPS.transform;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const figures: LaidFigure[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index];
    const args = argsArray[index];
    if (fn === save) {
      stack.push(ctm.slice());
      continue;
    }
    if (fn === restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fn === transform && Array.isArray(args)) {
      const next = args.filter((value): value is number => typeof value === 'number');
      if (next.length >= 6) ctm = pdfjs.Util.transform(ctm, next);
      continue;
    }
    if (fn === undefined || !imageOps.has(fn)) continue;
    const box = boxFromCtm(ctm, (x, y) => viewport.convertToViewportPoint(x, y));
    if (!box) continue;
    const key = [
      Math.round(box.x),
      Math.round(box.y),
      Math.round(box.width),
      Math.round(box.height),
    ].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    figures.push(box);
  }
  return figures;
}

function runsOnPage(
  items: unknown[],
  styles: Record<string, { fontFamily?: string }> | undefined,
  viewport: PdfViewport,
): LaidRun[] {
  const runs: LaidRun[] = [];
  for (const raw of items) {
    const item = asTextItem(raw);
    const transform = item?.transform;
    const str = item?.str ?? '';
    if (!item || !transform || transform.length < 6) continue;
    if (!str.replace(/\s/g, '')) continue;

    const [a, b, c, d, e, f] = transform as [number, number, number, number, number, number];
    const fontSize =
      Math.hypot(c, d) ||
      Math.hypot(a, b) ||
      Math.max(item.height ?? 0, 12);
    const advanceLength = Math.hypot(a, b) || 1;
    const verticalLength = Math.hypot(c, d) || 1;
    const widthInPageUnits = Math.max(0, item.width ?? 0);
    const heightInPageUnits = Math.max(item.height ?? 0, Math.hypot(c, d));
    const origin = viewport.convertToViewportPoint(e, f);
    const advance = viewport.convertToViewportPoint(
      e + (a / advanceLength) * widthInPageUnits,
      f + (b / advanceLength) * widthInPageUnits,
    );
    const vertical = viewport.convertToViewportPoint(
      e + (c / verticalLength) * heightInPageUnits,
      f + (d / verticalLength) * heightInPageUnits,
    );
    const farCorner = viewport.convertToViewportPoint(
      e + (a / advanceLength) * widthInPageUnits + (c / verticalLength) * heightInPageUnits,
      f + (b / advanceLength) * widthInPageUnits + (d / verticalLength) * heightInPageUnits,
    );
    const xs = [origin[0], advance[0], vertical[0], farCorner[0]];
    const ys = [origin[1], advance[1], vertical[1], farCorner[1]];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(0.5, Math.max(...xs) - x);
    const height = Math.max(1, Math.max(...ys) - y);
    const fontFamily = item.fontName ? styles?.[item.fontName]?.fontFamily : undefined;
    const fontName = [item.fontName, fontFamily].filter(Boolean).join(' ');
    runs.push({
      text: str,
      x,
      y,
      width,
      height,
      fontName: fontName || undefined,
    });
  }
  return runs;
}

function readablePdfError(err: unknown): Error {
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : '';
  if (name === 'PasswordException' || /password/i.test(message)) {
    return new Error('This PDF is password-protected.');
  }
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) {
    return new Error('This file is not a readable PDF.');
  }
  return new Error('Could not read this PDF.');
}

/** Read every page as the visible lines. A figure with no text becomes `[IMAGE]`. */
export async function readPdfAsRows(data: Uint8Array, signal?: AbortSignal): Promise<OcrAiPage[]> {
  signal?.throwIfAborted();
  const pdfjs = await loadPdfjs();
  signal?.throwIfAborted();
  let doc: PdfDocument;
  try {
    doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: true,
      verbosity: 0,
    }).promise;
  } catch (err) {
    throw readablePdfError(err);
  }

  try {
    if (doc.numPages > MAX_OCR_PAGES) {
      throw new Error(`PDF has too many pages (max ${MAX_OCR_PAGES})`);
    }
    const pages: OcrAiPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      signal?.throwIfAborted();
      const page = await doc.getPage(pageNumber);
      signal?.throwIfAborted();
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      signal?.throwIfAborted();
      const operators = await page.getOperatorList();
      signal?.throwIfAborted();
      const runs = runsOnPage(content.items, content.styles, viewport);
      const figures = figuresOnPage({
        fnArray: operators.fnArray,
        argsArray: operators.argsArray,
        pdfjs,
        viewport,
      });
      pages.push({
        page: pageNumber,
        rows: layoutToRows(runs, figures),
      });
      page.cleanup();
    }
    return pages;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('PDF has too many pages')) throw err;
    throw readablePdfError(err);
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
