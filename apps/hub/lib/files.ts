import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import {
  FILE_DISPLAY_NAME_MAX,
  FILE_MAX_BYTES,
  FILE_MAX_PER_WORKSPACE,
  APP_CATALOG,
  STUDIO_MESH_EXTENSIONS,
  TASK_PHOTO_MAX_BYTES,
  isTaskPhotoMime,
  type OwnStorageErrorCode,
  type SubscriptionTierId,
  type UploadRecord,
  type WorkspaceFile,
} from '@sorye/types';
import { jsonDataFile } from '@/lib/store/json-file';
import { putFileBlob, streamFileBlob, deleteFileBlob } from './file-blobs';
import {
  OwnStorageError,
  deleteExternalFile,
  noteStorageFailure,
  readExternalFile,
  sha256Hex,
  uploadDestination,
  type UploadDestination,
} from './upload-storage/service';
import { QuotaExceededError, finishUpload, markFileDeleted, recordRejected, reserveUpload } from './upload-storage/store';

/** Bytes kept on the customer's own drive or database rather than Sorye's storage. */
function isExternal(file: WorkspaceFile): boolean {
  return file.storedIn === 'drive' || file.storedIn === 'database';
}

async function readExternal(file: WorkspaceFile): Promise<Buffer> {
  try {
    return await readExternalFile(file.workspaceId, file);
  } catch (error) {
    if (error instanceof OwnStorageError && error.code === 'integrity_failed') {
      throw new FileAccessError('This file was changed outside Sorye and is not served. Check your own storage.', 502);
    }
    throw new FileAccessError('Your own storage could not be reached. Try again or check the connection in Relay.', 503);
  }
}

type FileStore = Record<string, WorkspaceFile[]>;

const metaFile = jsonDataFile<FileStore>('files-meta.json', () => ({}));

const FILES_ROOT = path.join(process.cwd(), '.data', 'files');

/** UUID v4 storage id — never a user-facing name. */
const FILE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Workspace folder segment: no slashes, dots-only, or `..`. */
const SAFE_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

const BLOCKED_EXTENSIONS = new Set([
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
  ) {
    super(message);
    this.name = 'FileAccessError';
  }
}

function assertSafeSegment(value: string, label: string): string {
  if (
    !SAFE_SEGMENT_RE.test(value) ||
    value.includes('..') ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new FileAccessError(`Invalid ${label}`, 400);
  }
  return value;
}

function assertFileId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (!FILE_ID_RE.test(normalized)) {
    throw new FileAccessError('Invalid file id', 400);
  }
  assertSafeSegment(normalized, 'file id');
  return normalized;
}

function withDirPrefix(dir: string): string {
  const root = path.resolve(dir);
  return root.endsWith(path.sep) ? root : `${root}${path.sep}`;
}

/** `path.resolve` + prefix check so a resolved path cannot leave `parent`. */
function assertInsideDir(parent: string, candidate: string): string {
  const root = path.resolve(parent);
  const resolved = path.resolve(candidate);
  const prefix = withDirPrefix(root);
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new FileAccessError('Path is outside the workspace directory', 400);
  }
  return resolved;
}

function workspaceDir(workspaceId: string): string {
  const id = assertSafeSegment(workspaceId, 'workspace');
  return assertInsideDir(FILES_ROOT, path.join(FILES_ROOT, id));
}

function storedAbsolutePath(workspaceId: string, fileId: string): string {
  const dir = workspaceDir(workspaceId);
  const id = assertFileId(fileId);
  const resolved = assertInsideDir(dir, path.join(dir, id));
  if (path.dirname(resolved) !== dir) {
    throw new FileAccessError('Path is outside the workspace directory', 400);
  }
  return resolved;
}

function relativeStoragePath(workspaceId: string, fileId: string): string {
  return `${assertSafeSegment(workspaceId, 'workspace')}/${assertFileId(fileId)}`;
}

function cloneFile(file: WorkspaceFile): WorkspaceFile {
  return { ...file };
}

function listForWorkspace(store: FileStore, workspaceId: string): WorkspaceFile[] {
  return (store[workspaceId] ?? []).filter(
    (row) => row.workspaceId === workspaceId,
  );
}

function findInWorkspace(
  store: FileStore,
  workspaceId: string,
  fileId: string,
): WorkspaceFile | undefined {
  const id = assertFileId(fileId);
  return listForWorkspace(store, workspaceId).find((row) => row.id === id);
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
  const base = name.replace(/^.*[/\\]/, '');
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
  const ext = extensionOf(displayName);
  if (BLOCKED_EXTENSIONS.has(ext) || isExecutableMagic(buf)) {
    throw new FileAccessError('That file type is not allowed', 400);
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
    throw new FileAccessError('That file type is not allowed', 400);
  }

  if (kind === 'ole') {
    if (ext === '.doc') return 'application/msword';
    if (ext === '.xls') return 'application/vnd.ms-excel';
    if (ext === '.ppt') return 'application/vnd.ms-powerpoint';
    throw new FileAccessError('That file type is not allowed', 400);
  }

  if (kind === 'text') {
    if (ext === '.csv') return 'text/csv';
    if (ext === '.md' || ext === '.markdown') return 'text/markdown';
    if (ext === '.json') return 'application/json';
    if (ext === '.txt' || ext === '.log' || ext === '') return 'text/plain';
    throw new FileAccessError('That file type is not allowed', 400);
  }

  throw new FileAccessError('That file type is not allowed', 400);
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

export async function listWorkspaceFiles(
  workspaceId: string,
): Promise<WorkspaceFile[]> {
  assertSafeSegment(workspaceId, 'workspace');
  const store = await metaFile.read(workspaceId);
  return listForWorkspace(store, workspaceId)
    .map(cloneFile)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getWorkspaceFile(
  workspaceId: string,
  fileId: string,
): Promise<WorkspaceFile> {
  const store = await metaFile.read(workspaceId);
  const row = findInWorkspace(store, workspaceId, fileId);
  if (!row) {
    throw new FileAccessError('File not found', 404);
  }
  storedAbsolutePath(row.workspaceId, row.id);
  return cloneFile(row);
}

export async function readWorkspaceFileBytes(
  workspaceId: string,
  fileId: string,
): Promise<{ file: WorkspaceFile; bytes: Buffer }> {
  const file = await getWorkspaceFile(workspaceId, fileId);
  if (file.workspaceId !== workspaceId) {
    throw new FileAccessError('File not found', 404);
  }
  if (isExternal(file)) return { file, bytes: await readExternal(file) };
  try {
    const stream = await streamFileBlob(workspaceId, fileId);
    const reader = stream.getReader();
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > FILE_MAX_BYTES) throw new FileAccessError('File exceeds size limit', 413);
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const bytes = Buffer.concat(chunks, length);
    return { file, bytes };
  } catch (error) {
    if (error instanceof FileAccessError) throw error;
    throw new FileAccessError('File storage is temporarily unavailable', 503);
  }
}

/** Who uploads, for the upload ledger and the own-storage plan check. */
export interface FileUploader {
  userId: string;
  tier: SubscriptionTierId;
}

const OWN_STORAGE_UPLOAD_MESSAGES: Partial<Record<OwnStorageErrorCode, [string, number]>> = {
  not_eligible: ['Uploads go to your own storage, but this workspace plan no longer includes it. Switch uploads back to Sorye storage in Relay or upgrade the plan.', 403],
  target_not_ready: ['Your own storage is not set up completely. Check it in Relay → Your storage.', 503],
  encryption_unavailable: ['Your own storage cannot be used right now. Ask your Sorye administrator.', 503],
  quota_exceeded: ['The storage limit you set for your own storage is reached. Raise it in Relay or delete files.', 413],
};

function ownStorageFailure(code: OwnStorageErrorCode): FileAccessError {
  const known = OWN_STORAGE_UPLOAD_MESSAGES[code];
  // Fail closed: the file is not stored anywhere, including Sorye's storage.
  return new FileAccessError(known?.[0] ?? 'Your own storage could not be reached, so the file was not uploaded. Try again or check the connection in Relay.', known?.[1] ?? 503);
}

export async function createWorkspaceFile(input: {
  workspaceId: string;
  displayName: string;
  bytes: Buffer;
  sourceAppId?: string;
  uploader: FileUploader;
}): Promise<WorkspaceFile> {
  const sourceAppId = input.sourceAppId ?? 'files';
  if (!APP_CATALOG.some((app) => app.id === sourceAppId)) {
    throw new FileAccessError('Unknown source app', 400);
  }
  const workspaceId = assertSafeSegment(input.workspaceId, 'workspace');
  const displayName = sanitizeDisplayName(input.displayName);
  const ledger: UploadRecord = {
    id: randomUUID(), workspaceId, fileId: null, userId: input.uploader.userId, target: 'sorye', location: null,
    displayName, mime: null, size: input.bytes.length, sha256: null, sourceAppId,
    status: 'rejected', errorCode: 'file_rejected', createdAt: new Date().toISOString(), completedAt: null,
  };
  const reject = async (error: FileAccessError, errorCode: UploadRecord['errorCode'] = 'file_rejected') => {
    await recordRejected({ ...ledger, errorCode, completedAt: new Date().toISOString() }).catch(() => undefined);
    return error;
  };

  // 1. Validate the file itself: size, blocked types, content sniffing.
  let mime: string;
  try {
    if (input.bytes.length === 0) throw new FileAccessError('File is empty', 400);
    if (input.bytes.length > FILE_MAX_BYTES) {
      throw new FileAccessError(`File is too large (max ${Math.floor(FILE_MAX_BYTES / (1024 * 1024))} MB)`, 400);
    }
    mime = resolveMime(input.bytes, displayName);
    if (sourceAppId === 'tasks') {
      const photoError = taskSectionPhotoError(input.bytes.length, mime);
      if (photoError) throw new FileAccessError(photoError, 400);
    }
  } catch (error) {
    if (error instanceof FileAccessError) throw await reject(error);
    throw error;
  }

  // 2. Decide where the bytes go. Own storage fails closed.
  let destination: UploadDestination | null;
  try {
    destination = await uploadDestination(workspaceId, input.uploader.tier);
  } catch (error) {
    const code = error instanceof OwnStorageError ? error.code : 'storage_unavailable';
    throw await reject(ownStorageFailure(code), code);
  }
  const target = destination?.target ?? 'sorye';
  const id = randomUUID();
  const sha256 = sha256Hex(input.bytes);
  const relativePath = relativeStoragePath(workspaceId, id);
  storedAbsolutePath(workspaceId, id);
  const now = new Date().toISOString();
  const row: WorkspaceFile = {
    sourceAppId, id, workspaceId, displayName, relativePath, storedIn: target, sha256, mime,
    size: input.bytes.length, createdAt: now, updatedAt: now,
  };

  // 3. Reserve the space (checked against the owner's limit under a lock).
  try {
    await reserveUpload({ ...ledger, target, fileId: id, mime, sha256, status: 'pending', errorCode: null }, destination?.limitBytes ?? null);
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      throw await reject(ownStorageFailure('quota_exceeded'), 'quota_exceeded');
    }
    throw new FileAccessError('File storage is temporarily unavailable', 503);
  }

  // 4. Store the bytes.
  let location: string;
  try {
    if (destination) {
      location = await destination.put(id, input.bytes, mime, sha256, displayName);
    } else {
      await putFileBlob(workspaceId, id, input.bytes, mime);
      location = `files/${workspaceId}/${id}`;
    }
  } catch (error) {
    const code: OwnStorageErrorCode = error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: OwnStorageErrorCode }).code : 'storage_unavailable';
    await finishUpload(workspaceId, ledger.id, { status: 'failed', errorCode: destination ? code : 'storage_unavailable' }).catch(() => undefined);
    if (destination) {
      await noteStorageFailure(workspaceId, destination.target as 'drive' | 'database', code).catch(() => undefined);
      throw ownStorageFailure(code);
    }
    throw new FileAccessError('File storage is temporarily unavailable', 503);
  }

  // 5. Add the Drive record; undo the stored bytes if that fails.
  try {
    const saved = await metaFile.update((store) => {
      const existing = listForWorkspace(store, workspaceId);
      if (existing.length >= FILE_MAX_PER_WORKSPACE) {
        throw new FileAccessError(`This workspace already has ${FILE_MAX_PER_WORKSPACE} files`, 400);
      }
      store[workspaceId] = [...existing, row];
      return cloneFile(row);
    }, input.workspaceId);
    await finishUpload(workspaceId, ledger.id, { status: 'stored', location }).catch(() => undefined);
    return saved;
  } catch (err) {
    if (destination) await deleteExternalFile(workspaceId, row).catch(() => undefined);
    else await deleteFileBlob(workspaceId, id).catch(() => undefined);
    await finishUpload(workspaceId, ledger.id, { status: err instanceof FileAccessError ? 'rejected' : 'failed', errorCode: err instanceof FileAccessError ? 'file_rejected' : 'storage_unavailable' }).catch(() => undefined);
    throw err;
  }
}

export async function renameWorkspaceFile(
  workspaceId: string,
  fileId: string,
  displayName: string,
): Promise<WorkspaceFile> {
  const nextName = sanitizeDisplayName(displayName);
  return metaFile.update((store) => {
    const rows = listForWorkspace(store, workspaceId);
    const index = rows.findIndex((row) => row.id === assertFileId(fileId));
    if (index < 0) {
      throw new FileAccessError('File not found', 404);
    }
    const current = rows[index];
    if (!current || current.workspaceId !== workspaceId) {
      throw new FileAccessError('File not found', 404);
    }
    storedAbsolutePath(current.workspaceId, current.id);
    const updated: WorkspaceFile = {
      ...current,
      displayName: nextName,
      updatedAt: new Date().toISOString(),
    };
    const next = [...rows];
    next[index] = updated;
    store[workspaceId] = next;
    return cloneFile(updated);
  }, workspaceId);
}

export async function deleteWorkspaceFile(
  workspaceId: string,
  fileId: string,
): Promise<void> {
  // Customer storage first: if it cannot be reached, keep the record so the file is not orphaned there.
  const existing = await getWorkspaceFile(workspaceId, fileId);
  if (isExternal(existing)) {
    try {
      await deleteExternalFile(workspaceId, existing);
    } catch {
      throw new FileAccessError('Your own storage could not be reached, so the file was not deleted. Try again or check the connection in Relay.', 503);
    }
  }
  const row = await metaFile.update((store) => {
    const rows = listForWorkspace(store, workspaceId);
    const index = rows.findIndex((item) => item.id === assertFileId(fileId));
    if (index < 0) {
      throw new FileAccessError('File not found', 404);
    }
    const current = rows[index];
    if (!current || current.workspaceId !== workspaceId) {
      throw new FileAccessError('File not found', 404);
    }
    store[workspaceId] = rows.filter((_, i) => i !== index);
    return current;
  }, workspaceId);

  if (!isExternal(row)) await deleteFileBlob(row.workspaceId, row.id);
  await markFileDeleted(workspaceId, row.id).catch(() => undefined);
}

export async function streamWorkspaceFile(workspaceId: string, fileId: string) {
  const file = await getWorkspaceFile(workspaceId, fileId);
  if (isExternal(file)) {
    // Buffered (at most FILE_MAX_BYTES) so size and SHA-256 are checked before anything is sent.
    const bytes = await readExternal(file);
    return { file, body: new Blob([new Uint8Array(bytes)]).stream() };
  }
  try {
    return { file, body: await streamFileBlob(workspaceId, file.id) };
  } catch {
    throw new FileAccessError('File storage is temporarily unavailable', 503);
  }
}
