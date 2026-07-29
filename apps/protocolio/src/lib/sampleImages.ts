export interface SampleImageOption {
  id: string;
  label: string;
  url: string;
}

/** Remote origin so samples resolve when mounted inside the hub (port 3000). */
const ASSET_ORIGIN =
  (import.meta.env.VITE_PROTOCOLIO_ORIGIN as string | undefined)?.replace(/\/$/, '') ??
  (import.meta.env.DEV ? 'http://localhost:3007' : '');

function assetUrl(path: string): string {
  return `${ASSET_ORIGIN}${path}`;
}

export const SAMPLE_IMAGES: SampleImageOption[] = [
  { id: 'logo', label: 'Acme Logo', url: assetUrl('/sample-images/logo.svg') },
  { id: 'banner', label: 'Blue Banner', url: assetUrl('/sample-images/banner.svg') },
  { id: 'chart', label: 'Sample Chart', url: assetUrl('/sample-images/chart.svg') },
];

export async function urlToDataUri(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load image: ${url}`);
  const blob = await res.blob();
  return fileToDataUri(new File([blob], 'image', { type: blob.type }));
}

export function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function isDataUri(src: string): boolean {
  return src.startsWith('data:');
}

export function dataUriPreview(src: string, maxLen = 48): string {
  if (!src) return '';
  if (isDataUri(src)) return `${src.slice(0, maxLen)}…`;
  return src;
}
