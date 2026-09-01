import { canvasToPreviewUrl, type PreparedImage } from './prepare-image';
import {
  isPdfFile,
  preparePdfPage,
  type PreparedPdfPage,
} from './prepare-pdf';

export type PreparedFile = PreparedPdfPage;

export { isPdfFile, canvasToPreviewUrl };

export function isAcceptedUpload(file: File): boolean {
  return isPdfFile(file);
}

export async function prepareFileForOcr(
  file: File,
  pdfPage = 1,
): Promise<PreparedFile> {
  if (!isPdfFile(file)) {
    throw new Error('Only PDF documents are supported.');
  }
  return preparePdfPage(file, pdfPage);
}

export type { PreparedImage, PreparedPdfPage };
