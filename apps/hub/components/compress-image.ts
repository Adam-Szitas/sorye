/** Shrink images before storing as data URLs (same caps as Messenger). */

export interface CompressedImage {
  dataUrl: string;
  width: number;
  height: number;
  bytesApprox: number;
}

const MAX_EDGE = 1280;
const TARGET_BYTES = 220_000;
const MIN_QUALITY = 0.45;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Compression failed'));
        else resolve(blob);
      },
      type,
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not encode image'));
    reader.readAsDataURL(blob);
  });
}

export async function compressImageFile(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files are supported');
  }

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(img, 0, 0, width, height);

  let quality = 0.72;
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality);

  while (blob.size > TARGET_BYTES && quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, quality - 0.08);
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  }

  if (blob.size > TARGET_BYTES * 1.4) {
    const shrink = 0.75;
    canvas.width = Math.max(1, Math.round(width * shrink));
    canvas.height = Math.max(1, Math.round(height * shrink));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    blob = await canvasToBlob(canvas, 'image/jpeg', MIN_QUALITY);
  }

  const dataUrl = await blobToDataUrl(blob);
  return {
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    bytesApprox: blob.size,
  };
}

export async function imageFileFromClipboardItem(
  item: DataTransferItem,
): Promise<File | null> {
  if (!item.type.startsWith('image/')) return null;
  const file = item.getAsFile();
  return file;
}
