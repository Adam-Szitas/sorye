/** Max-quality prepare: upscale, sharpen, contrast, + binary variant for Tesseract. */

export interface PreparedImage {
  canvas: HTMLCanvasElement;
  /** Binarized variant — second pass for faded/low-contrast shots. */
  binaryCanvas: HTMLCanvasElement;
  width: number;
  height: number;
  originalBytes: number;
}

/** Max long edge — Tesseract reads small text best around 300 DPI equivalent. */
export const MAX_EDGE = 3200;
/** Upscale until long edge reaches this (within MAX_EDGE). */
export const TARGET_MIN_EDGE = 1800;

export function computeLongEdgeScale(width: number, height: number): number {
  const longEdge = Math.max(width, height);
  let targetLong = longEdge;

  if (longEdge > MAX_EDGE) {
    targetLong = MAX_EDGE;
  } else if (longEdge < TARGET_MIN_EDGE) {
    targetLong = Math.min(TARGET_MIN_EDGE, MAX_EDGE);
  }

  return targetLong / longEdge;
}

async function decodeScaled(file: File): Promise<ImageBitmap> {
  const orient = { imageOrientation: 'from-image' as const };
  let probe: ImageBitmap;
  try {
    probe = await createImageBitmap(file, orient);
  } catch {
    probe = await createImageBitmap(file);
  }

  const scale = computeLongEdgeScale(probe.width, probe.height);
  if (Math.abs(scale - 1) < 0.01) return probe;

  const width = Math.max(1, Math.round(probe.width * scale));
  const height = Math.max(1, Math.round(probe.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return probe;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(probe, 0, 0, width, height);
  probe.close();

  return createImageBitmap(canvas);
}

function enhanceGrayscale(data: Uint8ClampedArray, pixels: number): Uint8Array {
  const gray = new Uint8Array(pixels);
  let min = 255;
  let max = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const g = Math.round(
      data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114,
    );
    gray[p] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }

  const range = Math.max(1, max - min);
  const contrast = 1.18;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    let v = ((gray[p]! - min) / range) * 255;
    v = Math.min(255, Math.max(0, (v - 128) * contrast + 128));
    const byte = Math.round(v);
    data[i] = byte;
    data[i + 1] = byte;
    data[i + 2] = byte;
    data[i + 3] = 255;
    gray[p] = byte;
  }

  return gray;
}

function sharpenGray(gray: Uint8Array, width: number, height: number): void {
  const copy = gray.slice();
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let sum = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          sum += copy[(y + ky) * width + (x + kx)]! * kernel[ki]!;
          ki += 1;
        }
      }
      gray[y * width + x] = Math.min(255, Math.max(0, sum));
    }
  }
}

function otsuThreshold(gray: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]! += 1;

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i]!;

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t += 1) {
    wB += hist[t]!;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t]!;
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

function buildBinaryCanvas(
  gray: Uint8Array,
  width: number,
  height: number,
): HTMLCanvasElement {
  const threshold = otsuThreshold(gray);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return canvas;

  const imageData = ctx.createImageData(width, height);
  const { data } = imageData;
  for (let p = 0; p < gray.length; p += 1) {
    const v = gray[p]! >= threshold ? 255 : 0;
    const i = p * 4;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** Enhance / binarize for scanned PDF page renders. */
export function enhanceCanvas(
  canvas: HTMLCanvasElement,
): Pick<PreparedImage, 'canvas' | 'binaryCanvas'> {
  const width = canvas.width;
  const height = canvas.height;
  const pixels = width * height;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas unavailable');

  const imageData = ctx.getImageData(0, 0, width, height);
  const gray = enhanceGrayscale(imageData.data, pixels);
  sharpenGray(gray, width, height);

  for (let p = 0; p < pixels; p += 1) {
    const v = gray[p]!;
    const i = p * 4;
    imageData.data[i] = v;
    imageData.data[i + 1] = v;
    imageData.data[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);

  const binaryCanvas = buildBinaryCanvas(gray, width, height);
  return { canvas, binaryCanvas };
}

export async function prepareImageForOcr(file: File): Promise<PreparedImage> {
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

  const { canvas: enhanced, binaryCanvas } = enhanceCanvas(canvas);

  return {
    canvas: enhanced,
    binaryCanvas,
    width: enhanced.width,
    height: enhanced.height,
    originalBytes: file.size,
  };
}

export function canvasToPreviewUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not create preview'));
        return;
      }
      resolve(URL.createObjectURL(blob));
    }, 'image/png');
  });
}
