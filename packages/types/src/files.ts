/** Workspace Drive / Files — metadata only; bytes live on Hub disk. */

export const FILE_DISPLAY_NAME_MAX = 180;
/** Upload cap (bytes). Bytes are never stored in the JSON/Postgres record. */
export const FILE_MAX_BYTES = 25 * 1024 * 1024;
export const FILE_MAX_PER_WORKSPACE = 200;

export const FILE_ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export type FileAllowedMime = (typeof FILE_ALLOWED_MIMES)[number];

/**
 * Safe to serve with `Content-Disposition: inline` and in-app preview.
 * Raster images, PDF, and plain text only — never HTML, SVG, or script.
 */
export const FILE_INLINE_PREVIEW_MIMES = [
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

export type FileInlinePreviewMime = (typeof FILE_INLINE_PREVIEW_MIMES)[number];

/** Client-side Drive regex cap — never compile unbounded user patterns on the server. */
export const FILE_SEARCH_REGEX_MAX = 80;

export function isFileInlinePreviewable(
  mime: string,
): mime is FileInlinePreviewMime {
  return (FILE_INLINE_PREVIEW_MIMES as readonly string[]).includes(mime);
}

/** Server-side file row. `relativePath` is workspaceId/id — never user-supplied. */
export interface WorkspaceFile {
  id: string;
  workspaceId: string;
  displayName: string;
  relativePath: string;
  mime: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileListResponse {
  files: WorkspaceFile[];
  maxBytes: number;
  maxFiles: number;
}
