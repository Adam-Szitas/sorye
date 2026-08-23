/** Fast prepare: decode + resize via createImageBitmap (no per-pixel loops). */

export interface PreparedImage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  originalBytes: number;
}

/** Sweet spot: enough for table OCR, much faster than full-res phone shots. */
const MAX_EDGE = 1280;

async function decodeScaled(file: File): Promise<ImageBitmap> {
  const probe = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(probe.width, probe.height));
  const width = Math.max(1, Math.round(probe.width * scale));
  const height = Math.max(1, Math.round(probe.height * scale));

  if (scale >= 1) return probe;

  probe.close();
  return createImageBitmap(file, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: 'medium',
  });
}

/**
 * Downscale long edge to ≤1280 using the browser's image decoder.
 * Skips grayscale pixel walks — Tesseract handles color fine and CPU stays free for OCR.
 */
export async function prepareImageForOcr(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are supported');
  }

  const bitmap = await decodeScaled(file);
  const width = bitmap.width;
  const height = bitmap.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    bitmap.close();
    throw new Error('Canvas unavailable');
  }

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return {
    canvas,
    width,
    height,
    originalBytes: file.size,
  };
}
