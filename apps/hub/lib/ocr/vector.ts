import type { OcrAiPage, OcrDocumentVector, OcrPageNote } from '@sorye/types';
import { OCR_IMAGE_MARKER } from '@sorye/types';

export function flattenLines(pages: OcrAiPage[]): string[] {
  return pages.flatMap((page) => page.rows);
}

function pageNote(page: OcrAiPage): OcrPageNote {
  const residue = page.rows
    .join('')
    .split(OCR_IMAGE_MARKER)
    .join('')
    .replace(/[_\s]/g, '');
  const hasImage = page.rows.some((row) => row.includes(OCR_IMAGE_MARKER));
  if (hasImage && residue.length === 0) {
    return {
      page: page.page,
      complete: false,
      warning: `Page ${page.page} contains images without extracted text. Server analysis does not perform OCR on scans.`,
    };
  }
  if (page.rows.length === 0 || residue.length === 0) {
    return {
      page: page.page,
      complete: false,
      warning: `Page ${page.page} has no extracted text.`,
    };
  }
  return { page: page.page, complete: true, warning: null };
}

export function withCursor(
  vector: OcrDocumentVector,
  cursor: OcrDocumentVector['cursor'] | null,
): OcrDocumentVector {
  const next = { ...vector };
  if (!cursor || cursor.total === 0 || cursor.next >= cursor.total) {
    delete next.cursor;
    return next;
  }
  next.cursor = cursor;
  return next;
}

/** Versioned map from the flat line vector back to pages. Line text stays on `pages`. */
export function buildVector(pages: OcrAiPage[]): OcrDocumentVector {
  const pageStarts: number[] = [];
  let lineCount = 0;
  for (const page of pages) {
    pageStarts.push(lineCount);
    lineCount += page.rows.length;
  }
  return {
    version: 1,
    pageStarts,
    lineCount,
    notes: pages.map(pageNote),
  };
}

export function completenessWarning(vector: OcrDocumentVector): string | null {
  const warnings = vector.notes
    .map((note) => note.warning)
    .filter((warning): warning is string => Boolean(warning));
  if (warnings.length === 0) return null;
  const imagePages = vector.notes
    .filter((note) => note.warning?.includes('without extracted text'))
    .map((note) => note.page);
  if (imagePages.length > 0 && imagePages.length === warnings.length) {
    return `Pages ${imagePages.join(', ')} contain images without extracted text. Server analysis does not perform OCR on scans.`;
  }
  return warnings.join(' ');
}
