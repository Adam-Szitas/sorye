/**
 * Drive edge policy kept in Hub (validation at the browser edge): blocked types, content
 * sniffing, display names, download disposition and the Tasks photo rule. Pure functions,
 * no storage. Rodrigo owns the records and bytes (alignment slice 2).
 */
import {
  FILE_DISPLAY_NAME_MAX,
  STUDIO_MESH_EXTENSIONS,
  TASK_PHOTO_MAX_BYTES,
  isTaskPhotoMime,
  type FileUploadErrorCode,
} from '@sorye/types';

const BLOCKED_EXTENSIONS = new Set([
  '.dmg', '.pkg', '.deb', '.rpm', '.app', '.appimage', '.msix', '.msp', '.psm1', '.psd1', '.vbe', '.jse', '.hta', '.lnk', '.url', '.reg', '.command', '.zsh', '.fish', '.pl', '.cgi', '.so', '.dylib', '.class',
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.scr',
  '.ps1',
  '.sh',
  '.bash',
  '.js',
  '.mjs',
  '.cjs',
  '.vbs',
  '.wsf',
  '.jar',
  '.apk',
  '.html',
  '.htm',
  '.svg',
  '.wasm',
  '.php',
  '.py',
  '.rb',
]);

export class FileAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: FileUploadErrorCode,
  ) {
    super(message);
    this.name = 'FileAccessError';
  }
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** A browser-supplied checksum: 64 lowercase hex characters, or undefined when absent. */
export function parseClientSha256(raw: unknown): string | undefined | null {
  if (raw === null || raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return SHA256_HEX_RE.test(value) ? value : null;
}

export function corrupted(code: 'checksum_mismatch' | 'integrity_failed', displayName: string): FileAccessError {
  return new FileAccessError(
    code === 'checksum_mismatch'
      ? `${displayName} was damaged on the way to Sorye. Upload this file again.`
      : `${displayName} was damaged while it was stored. Upload this file again.`,
    422,
    code,
  );
}

/** Tasks section photos are raster images under the task photo cap. Other Drive files keep the general policy. */
export function taskSectionPhotoError(byteLength: number, mime: string): string | null {
  if (!isTaskPhotoMime(mime)) return 'Tasks photos must be JPEG, PNG, WebP, or GIF images';
  if (byteLength <= 0 || byteLength > TASK_PHOTO_MAX_BYTES) {
    return `Tasks photos must be under ${Math.floor(TASK_PHOTO_MAX_BYTES / (1024 * 1024))} MB`;
  }
  return null;
}

export function sanitizeDisplayName(raw: string): string {
  const base = raw
    .replace(/^.*[/\\]/, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  const clipped = base.slice(0, FILE_DISPLAY_NAME_MAX);
  return clipped || 'Untitled';
}

function extensionOf(name: string): string {
  const base = name.replace(/^.*[/\\]/, '').replace(/[. ]+$/, '');
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0)) return false;
  let printable = 0;
  for (const byte of sample) {
    if (
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      (byte >= 0x20 && byte <= 0x7e) ||
      byte >= 0x80
    ) {
      printable += 1;
    }
  }
  return sample.length === 0 ? false : printable / sample.length >= 0.85;
}

function isExecutableMagic(buf: Buffer): boolean {
  if (buf.subarray(0, 2).toString() === '#!') return true;
  if (buf.length >= 4 && [0xcefaedfe, 0xbebafeca, 0xcafebabf, 0xbfbafeca, 0x0061736d].includes(buf.readUInt32BE(0))) return true;
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return true;
  if (
    buf.length >= 4 &&
    buf[0] === 0x7f &&
    buf[1] === 0x45 &&
    buf[2] === 0x4c &&
    buf[3] === 0x46
  ) {
    return true;
  }
  if (
    buf.length >= 4 &&
    ((buf[0] === 0xca && buf[1] === 0xfe && buf[2] === 0xba && buf[3] === 0xbe) ||
      (buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe) ||
      (buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfa && buf[3] === 0xce) ||
      (buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfa && buf[3] === 0xcf))
  ) {
    return true;
  }
  return false;
}

function detectKind(
  buf: Buffer,
): 'jpeg' | 'png' | 'gif' | 'webp' | 'pdf' | 'zip' | 'ole' | 'text' | 'unknown' {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return 'gif';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).equals(Buffer.from('RIFF')) &&
    buf.subarray(8, 12).equals(Buffer.from('WEBP'))
  ) {
    return 'webp';
  }
  if (buf.length >= 5 && buf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    return 'pdf';
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
    (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)
  ) {
    return 'zip';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0
  ) {
    return 'ole';
  }
  if (looksLikeText(buf)) return 'text';
  return 'unknown';
}

function resolveMime(buf: Buffer, displayName: string): string {
  if (displayName === '.sorye-folder') throw new FileAccessError('This name is reserved for folder metadata.', 400);
  const ext = extensionOf(displayName);
  if (BLOCKED_EXTENSIONS.has(ext) || isExecutableMagic(buf)) {
    throw new FileAccessError('Executable files, installers and active scripts are not allowed.', 400);
  }

  const kind = detectKind(buf);
  // Mesh documents are download-only: never serve embedded scripts/XML inline.
  if ((STUDIO_MESH_EXTENSIONS as readonly string[]).includes(ext.slice(1))) {
    return 'application/octet-stream';
  }
  if (kind === 'jpeg') return 'image/jpeg';
  if (kind === 'png') return 'image/png';
  if (kind === 'gif') return 'image/gif';
  if (kind === 'webp') return 'image/webp';
  if (kind === 'pdf') return 'application/pdf';

  if (kind === 'zip') {
    if (ext === '.docx') {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (ext === '.xlsx') {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    if (ext === '.pptx') {
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    }
    return 'application/octet-stream';
  }

  if (kind === 'ole') {
    if (ext === '.doc') return 'application/msword';
    if (ext === '.xls') return 'application/vnd.ms-excel';
    if (ext === '.ppt') return 'application/vnd.ms-powerpoint';
    return 'application/octet-stream';
  }

  if (kind === 'text') {
    if (ext === '.csv') return 'text/csv';
    if (ext === '.md' || ext === '.markdown') return 'text/markdown';
    if (ext === '.json') return 'application/json';
    if (ext === '.txt' || ext === '.log' || ext === '') return 'text/plain';
    return 'application/octet-stream';
  }

  return 'application/octet-stream';
}

/** Shared content sniffing/blocked-type policy for local and cloud Drive uploads. */
export function resolveWorkspaceFileMime(buf: Buffer, displayName: string): string {
  return resolveMime(buf, displayName);
}

/** `inline` only after the GET route checks `isInlinePreviewMime`. */
export function contentDisposition(
  displayName: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): string {
  const safe = sanitizeDisplayName(displayName);
  const ascii = safe
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .replace(/[\r\n]/g, '');
  const fallback = ascii || 'download';
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
  });
  const mode = disposition === 'inline' ? 'inline' : 'attachment';
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

