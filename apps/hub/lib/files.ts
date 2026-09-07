import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import {
  FILE_DISPLAY_NAME_MAX,
  FILE_MAX_BYTES,
  FILE_MAX_PER_WORKSPACE,
  type WorkspaceFile,
} from '@sorye/types';
import { jsonDataFile } from '@/lib/store/json-file';

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
  const store = await metaFile.read();
  return listForWorkspace(store, workspaceId)
    .map(cloneFile)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getWorkspaceFile(
  workspaceId: string,
  fileId: string,
): Promise<WorkspaceFile> {
  const store = await metaFile.read();
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
  const abs = storedAbsolutePath(file.workspaceId, file.id);
  try {
    const bytes = await readFile(abs);
    return { file, bytes };
  } catch {
    throw new FileAccessError('File not found', 404);
  }
}

export async function createWorkspaceFile(input: {
  workspaceId: string;
  displayName: string;
  bytes: Buffer;
}): Promise<WorkspaceFile> {
  const workspaceId = assertSafeSegment(input.workspaceId, 'workspace');
  if (input.bytes.length === 0) {
    throw new FileAccessError('File is empty', 400);
  }
  if (input.bytes.length > FILE_MAX_BYTES) {
    throw new FileAccessError(
      `File is too large (max ${Math.floor(FILE_MAX_BYTES / (1024 * 1024))} MB)`,
      400,
    );
  }

  const displayName = sanitizeDisplayName(input.displayName);
  const mime = resolveMime(input.bytes, displayName);
  const id = randomUUID();
  const relativePath = relativeStoragePath(workspaceId, id);
  const abs = storedAbsolutePath(workspaceId, id);
  const now = new Date().toISOString();

  const row: WorkspaceFile = {
    id,
    workspaceId,
    displayName,
    relativePath,
    mime,
    size: input.bytes.length,
    createdAt: now,
    updatedAt: now,
  };

  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, input.bytes);

  try {
    return await metaFile.update((store) => {
      const existing = listForWorkspace(store, workspaceId);
      if (existing.length >= FILE_MAX_PER_WORKSPACE) {
        throw new FileAccessError(
          `This workspace already has ${FILE_MAX_PER_WORKSPACE} files`,
          400,
        );
      }
      store[workspaceId] = [...existing, row];
      return cloneFile(row);
    });
  } catch (err) {
    await unlink(abs).catch(() => undefined);
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
  });
}

export async function deleteWorkspaceFile(
  workspaceId: string,
  fileId: string,
): Promise<void> {
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
  });

  const abs = storedAbsolutePath(row.workspaceId, row.id);
  await unlink(abs).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err;
  });
}
