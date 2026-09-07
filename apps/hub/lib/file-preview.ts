/** Raster images, PDF, and plain text — never HTML, SVG, or script. */
export const INLINE_PREVIEW_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
] as const;

/** Never inline HTML, SVG, or script even if metadata was tampered. */
const NEVER_INLINE_MIME = /html|svg|javascript|ecmascript|xml/i;

export function isInlinePreviewMime(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  if (!normalized || NEVER_INLINE_MIME.test(normalized)) return false;
  return (INLINE_PREVIEW_MIMES as readonly string[]).includes(normalized);
}
