/** Workspace Drive / Files — metadata only; bytes live on Hub disk. */

export const FILE_DISPLAY_NAME_MAX = 180;
/** Upload cap (bytes). Bytes are never stored in the JSON/Postgres record. */
export const FILE_MAX_BYTES = 64 * 1024 * 1024;
export const FILE_MAX_PER_WORKSPACE = 200;
/**
 * Task description photos. Raster images only, under the existing image ceiling
 * (`MAX_IMAGE_DATA_URL_LENGTH`) and the Drive file cap. The bytes are a Drive
 * file, not part of the task JSON or the Rodrigo action body.
 */
export const TASK_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const TASK_PHOTO_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export type TaskPhotoMime = (typeof TASK_PHOTO_MIMES)[number];

export function isTaskPhotoMime(value: string): value is TaskPhotoMime {
  return (TASK_PHOTO_MIMES as readonly string[]).includes(value);
}

export const FILE_ALLOWED_MIMES = [
  'application/octet-stream', // Download-only Studio mesh documents.
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
  folderPath?: string;
  id: string;
  workspaceId: string;
  displayName: string;
  /** App folder; older uploads without a source remain in Drive. */
  sourceAppId?: string;
  relativePath: string;
  /**
   * Where the bytes live. Missing on files stored before own storage existed,
   * which means Sorye's storage. Set once at upload and never changed.
   */
  storedIn?: 'sorye' | 'drive' | 'database';
  /** SHA-256 of the bytes at upload; checked before serving bytes from customer storage. */
  sha256?: string;
  mime: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Most files one browser upload queue accepts at once. The queue lowers this
 * on slow connections (see `planUploadBatch`); the server still enforces every
 * per-file, per-workspace, concurrency and throughput limit on its own.
 */
export const FILE_UPLOAD_BATCH_MAX = 25;
/** A queued batch should finish in about this many seconds on the measured connection. */
export const FILE_UPLOAD_BATCH_TARGET_SECONDS = 300;
/** Fixed per-request cost added to each file when estimating batch time. */
export const FILE_UPLOAD_PER_FILE_OVERHEAD_SECONDS = 0.4;
/** Files allowed when the connection speed is unknown. */
export const FILE_UPLOAD_BATCH_UNKNOWN_SPEED = 10;

/** Error codes the upload route returns in `code`, next to a readable `error`. */
export const FILE_UPLOAD_ERROR_CODES = [
  /** Bytes the server received differ from the checksum the browser computed. */
  'checksum_mismatch',
  /** Bytes read back from storage differ from what was received. */
  'integrity_failed',
  /** The active workspace changed after the file was queued. */
  'workspace_changed',
  /** Upload slots are busy; retry after `Retry-After`. */
  'busy',
  'too_large',
  'rejected',
  'storage_unavailable',
] as const;
export type FileUploadErrorCode = (typeof FILE_UPLOAD_ERROR_CODES)[number];

/** Codes after which the stored copy could not be trusted. The file must be uploaded again. */
export function isCorruptUploadCode(code: string | null | undefined): boolean {
  return code === 'checksum_mismatch' || code === 'integrity_failed';
}

/** Server-reported limits and usage for the active workspace. The server is the source of truth. */
export interface FileQuota {
  /** Largest single file the server accepts. */
  maxFileBytes: number;
  /** Most Drive files a workspace may hold. */
  maxFiles: number;
  fileCount: number;
  /** Bytes of Drive files in this workspace. */
  usedBytes: number;
  /** Byte limit of the storage uploads go to; null when only the file count is limited (Sorye storage). */
  limitBytes: number | null;
  target: 'sorye' | 'drive' | 'database';
  /** Server ceiling for one browser batch; the browser may queue fewer on a slow connection. */
  maxBatchFiles: number;
  /** Uploads one member may run at the same time. More are refused with 429. */
  maxConcurrentUploads: number;
  /** Lowest server throughput limit that applies to this member, or null when uploads are not throttled. */
  throttleBytesPerSecond: number | null;
}

export interface FileUploadErrorBody {
  error: string;
  code?: FileUploadErrorCode;
  /** The bytes did not survive the transfer or storage intact; ask for this file again. */
  corrupted?: boolean;
}

export interface UploadBatchPlan {
  /** Files to queue, from the start of the selection. */
  accepted: number;
  /** Seconds the accepted files should take at the estimated speed; null when the speed is unknown. */
  estimateSeconds: number | null;
  /** Why fewer files than selected were accepted. */
  limitedBy: 'connection' | 'server' | 'unknown-speed' | null;
}

/**
 * Decide how many of the selected files to queue. A slow connection gets a
 * smaller batch so a queue finishes in about `targetSeconds`; at least one
 * file is always accepted so any single allowed file can be uploaded.
 */
export function planUploadBatch(
  sizes: readonly number[],
  input: { bytesPerSecond: number | null; maxBatchFiles: number; targetSeconds?: number },
): UploadBatchPlan {
  const serverMax = Math.max(1, Math.floor(input.maxBatchFiles));
  const target = input.targetSeconds ?? FILE_UPLOAD_BATCH_TARGET_SECONDS;
  if (sizes.length === 0) return { accepted: 0, estimateSeconds: 0, limitedBy: null };
  const rate = input.bytesPerSecond;
  if (!rate || !Number.isFinite(rate) || rate <= 0) {
    const cap = Math.min(serverMax, FILE_UPLOAD_BATCH_UNKNOWN_SPEED);
    const accepted = Math.min(sizes.length, cap);
    const limitedBy = accepted < sizes.length ? (cap < serverMax ? 'unknown-speed' : 'server') : null;
    return { accepted, estimateSeconds: null, limitedBy };
  }
  let seconds = 0;
  let accepted = 0;
  for (const size of sizes) {
    if (accepted >= serverMax) break;
    const next = seconds + Math.max(0, size) / rate + FILE_UPLOAD_PER_FILE_OVERHEAD_SECONDS;
    if (accepted > 0 && next > target) break;
    seconds = next;
    accepted += 1;
  }
  const limitedBy = accepted < sizes.length ? (accepted >= serverMax ? 'server' : 'connection') : null;
  return { accepted, estimateSeconds: Math.round(seconds), limitedBy };
}

export interface FileListResponse {
  files: WorkspaceFile[];
  maxBytes: number;
  maxFiles: number;
  quota?: FileQuota;
  load?: import('./user-load').UserLoadPartition<WorkspaceFile>;
  workspace?: import('./user-load').UserLoadWorkspace;
}

/** Apps that can open the original bytes, rather than an exported derivative. */
export function fileOpenAppIds(mime: string): string[] {
  return mime === 'application/pdf' ? ['ocr'] : [];
}
