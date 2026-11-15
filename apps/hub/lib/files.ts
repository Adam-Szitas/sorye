import { randomUUID } from 'crypto';
import {
  APP_CATALOG,
  FILE_MAX_BYTES,
  FILE_MAX_PER_WORKSPACE,
  type FileQuota,
  type FileUploadErrorCode,
  type WorkspaceFile,
} from '@sorye/types';
import { RODRIGO_SERVICE_HUB_ACTOR } from '@sorye/types';
import {
  DriveUploadError,
  deleteDriveFile,
  driveUsage,
  getDriveFile,
  listDriveFiles,
  openDriveContent,
  recordDriveRejection,
  renameDriveFile,
  uploadDriveFile,
  type DriveFile,
} from './rodrigo/drive-client';
import { RodrigoResponseError, RodrigoUnavailableError, type RodrigoContext } from './rodrigo/service-client';
import { FileAccessError, corrupted, resolveWorkspaceFileMime, sanitizeDisplayName, taskSectionPhotoError } from './files-policy';

/**
 * Drive (alignment slice 2). Rodrigo owns file records, quota, the upload ledger, the
 * storage target (Sorye storage or the customer's own) and the bytes. Hub keeps the edge
 * policy in `files-policy.ts`, the upload slots and throttle, and streams bytes through.
 * No fallback: if Rodrigo cannot answer, the operation fails.
 *
 * `actor` is the signed-in member (`{ userId, workspaceId }`); a bare workspace id means
 * Hub acts as `service:hub` (background workers such as OCR).
 */
export * from './files-policy';

export type FileActor = RodrigoContext | string;
function ctx(actor: FileActor): RodrigoContext {
  return typeof actor === 'string' ? { userId: RODRIGO_SERVICE_HUB_ACTOR, workspaceId: actor } : actor;
}

function toWorkspaceFile(file: DriveFile, workspaceId: string): WorkspaceFile {
  return {
    id: file.id, workspaceId, displayName: file.displayName, sourceAppId: file.sourceAppId,
    folderPath: file.folderPath ?? '',
    relativePath: `files/${workspaceId}/${file.id}`, storedIn: file.storedIn, ...(file.sha256 ? { sha256: file.sha256 } : {}),
    mime: file.mime, size: file.size, createdAt: file.createdAt, updatedAt: file.updatedAt,
  };
}

const MESSAGES: Record<string, [string, number, FileUploadErrorCode?]> = {
  not_eligible: ['Uploads go to your own storage, but this workspace plan no longer includes it. Switch uploads back to Sorye storage in Relay or upgrade the plan.', 403],
  target_not_ready: ['Your own storage is not set up completely. Check it in Relay → Your storage.', 503],
  encryption_unavailable: ['Your own storage cannot be used right now. Ask your Sorye administrator.', 503],
  quota_exceeded: ['The storage limit you set for your own storage is reached. Raise it in Relay or delete files.', 413],
  too_many_files: [`This workspace already has ${FILE_MAX_PER_WORKSPACE} files`, 400],
  too_large: [`File is too large (max ${Math.floor(FILE_MAX_BYTES / (1024 * 1024))} MB)`, 400, 'too_large'],
  not_found: ['File not found', 404],
  upload_not_found: ['File not found', 404],
};

/** Maps a Rodrigo failure to the Drive error the routes already return. */
function mapError(error: unknown, displayName = 'The file'): FileAccessError {
  if (error instanceof FileAccessError) return error;
  const code = error instanceof DriveUploadError || error instanceof RodrigoResponseError ? error.code : null;
  if (code === 'checksum_mismatch' || code === 'integrity_failed') return corrupted(code, displayName);
  if (code && MESSAGES[code]) {
    const [message, status, uploadCode] = MESSAGES[code]!;
    return new FileAccessError(message, status, uploadCode);
  }
  if (error instanceof RodrigoResponseError && error.status === 403) return new FileAccessError('Not allowed', 403);
  if (error instanceof RodrigoUnavailableError || (error instanceof RodrigoResponseError && error.status >= 500)) {
    return new FileAccessError('File storage is temporarily unavailable', 503, 'storage_unavailable');
  }
  return new FileAccessError('File storage is temporarily unavailable', 503, 'storage_unavailable');
}

export async function listWorkspaceFiles(actor: FileActor): Promise<WorkspaceFile[]> {
  const context = ctx(actor);
  try {
    return (await listDriveFiles(context)).map((file) => toWorkspaceFile(file, context.workspaceId));
  } catch (error) {
    throw mapError(error);
  }
}

export async function getWorkspaceFile(actor: FileActor, fileId: string): Promise<WorkspaceFile> {
  const context = ctx(actor);
  try {
    return toWorkspaceFile(await getDriveFile(context, fileId), context.workspaceId);
  } catch (error) {
    throw mapError(error);
  }
}

/** Buffered read for server-side consumers (OCR, relay hand-offs); bounded by FILE_MAX_BYTES. */
export async function readWorkspaceFileBytes(actor: FileActor, fileId: string): Promise<{ file: WorkspaceFile; bytes: Buffer }> {
  const { file, body } = await streamWorkspaceFile(actor, fileId);
  const reader = body.getReader();
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
  } catch (error) {
    throw error instanceof FileAccessError ? error : new FileAccessError('File storage is temporarily unavailable', 503);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { file, bytes: Buffer.concat(chunks, length) };
}

/** Streamed bytes for the download route; Rodrigo checked the SHA-256 when it stored them. */
export async function streamWorkspaceFile(actor: FileActor, fileId: string, range?: string) {
  const file = await getWorkspaceFile(actor, fileId);
  try {
    const response = await openDriveContent(ctx(actor), fileId, range);
    if (!response.body) throw new FileAccessError('File storage is temporarily unavailable', 503);
    return { file, body: response.body, status: response.status, contentRange: response.headers.get('content-range'), length: response.headers.get('content-length') };
  } catch (error) {
    throw mapError(error, file.displayName);
  }
}

/** Who uploads (the tier is checked by Rodrigo from its own identity records). */
export interface FileUploader { userId: string; /** Ignored: Rodrigo checks the plan from its own records. */ tier?: string }

/**
 * Creates a Drive file from a byte stream. The first bytes are sniffed here (blocked types,
 * content kind); everything else (quota, ledger, own storage, integrity) is Rodrigo's.
 */
export async function createWorkspaceFileFromStream(input: {
  folderPath?: string;
  workspaceId: string; uploader: FileUploader; displayName: string; sourceAppId?: string;
  source: AsyncIterable<Uint8Array>; size?: number; maxBytes?: number; expectedSha256?: string;
  finalSha256?: () => string | undefined | Promise<string | undefined>;
}): Promise<WorkspaceFile> {
  const context: RodrigoContext = { userId: input.uploader.userId, workspaceId: input.workspaceId };
  const sourceAppId = input.sourceAppId ?? 'files';
  if (!APP_CATALOG.some((app) => app.id === sourceAppId)) throw new FileAccessError('Unknown source app', 400);
  const displayName = sanitizeDisplayName(input.displayName);
  const fileId = randomUUID();
  const reject = async (error: FileAccessError, code = 'file_rejected') => {
    await recordDriveRejection(context, { fileId, displayName, sourceAppId, code }).catch(() => undefined);
    return error;
  };
  // Read enough to sniff the type (8 KiB), then replay it in front of the rest.
  const iterator = input.source[Symbol.asyncIterator]();
  const head: Buffer[] = [];
  let headSize = 0;
  let ended = false;
  while (headSize < 8192) {
    const next = await iterator.next();
    if (next.done) { ended = true; break; }
    const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
    head.push(chunk);
    headSize += chunk.length;
  }
  const first = Buffer.concat(head, headSize);
  if (headSize === 0) throw await reject(new FileAccessError('File is empty', 400));
  let mime: string;
  try {
    mime = resolveWorkspaceFileMime(first, displayName);
    if (sourceAppId === 'tasks') {
      const photoError = taskSectionPhotoError(input.size ?? headSize, mime);
      if (photoError) throw new FileAccessError(photoError, 400);
    }
  } catch (error) {
    if (error instanceof FileAccessError) throw await reject(error);
    throw error;
  }
  async function* replay(): AsyncIterable<Uint8Array> {
    if (first.length) yield first;
    if (ended) return;
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  try {
    const file = await uploadDriveFile(context, {
      fileId, displayName, mime, sourceAppId,
      folderPath: input.folderPath ?? '',
      ...(input.size !== undefined ? { size: input.size } : { maxBytes: Math.min(input.maxBytes ?? FILE_MAX_BYTES, FILE_MAX_BYTES) }),
      ...(input.expectedSha256 ? { sha256: input.expectedSha256 } : {}),
    }, replay(), { finalSha256: input.finalSha256 });
    if (sourceAppId === 'tasks') {
      const photoError = taskSectionPhotoError(file.size, mime);
      if (photoError) {
        await deleteDriveFile(context, file.id).catch(() => undefined);
        throw new FileAccessError(photoError, 400);
      }
    }
    return toWorkspaceFile(file, input.workspaceId);
  } catch (error) {
    throw mapError(error, displayName);
  }
}

/** Buffer convenience for server-side producers (OCR, MCP tools, relay). */
export async function createWorkspaceFile(input: {
  workspaceId: string; displayName: string; bytes: Buffer; sourceAppId?: string;
  uploader: FileUploader; expectedSha256?: string;
}): Promise<WorkspaceFile> {
  if (input.bytes.length > FILE_MAX_BYTES) {
    throw new FileAccessError(`File is too large (max ${Math.floor(FILE_MAX_BYTES / (1024 * 1024))} MB)`, 400, 'too_large');
  }
  return createWorkspaceFileFromStream({
    workspaceId: input.workspaceId, uploader: input.uploader, displayName: input.displayName, sourceAppId: input.sourceAppId,
    size: input.bytes.length, expectedSha256: input.expectedSha256,
    source: (async function* () { yield input.bytes; })(),
  });
}

export async function renameWorkspaceFile(actor: FileActor, fileId: string, displayName: string): Promise<WorkspaceFile> {
  const context = ctx(actor);
  try {
    return toWorkspaceFile(await renameDriveFile(context, fileId, sanitizeDisplayName(displayName)), context.workspaceId);
  } catch (error) {
    throw mapError(error);
  }
}

export async function deleteWorkspaceFile(actor: FileActor, fileId: string): Promise<void> {
  try {
    await deleteDriveFile(ctx(actor), fileId);
  } catch (error) {
    if (error instanceof RodrigoResponseError && error.status === 503) {
      throw new FileAccessError('Your own storage could not be reached, so the file was not deleted. Try again or check the connection in Relay.', 503);
    }
    throw mapError(error);
  }
}

/** Upload limits and usage for one workspace. Read on every Drive load; Rodrigo is the source of truth. */
export async function getFileQuota(
  actor: FileActor,
  limits: { maxConcurrentUploads: number; throttleBytesPerSecond: number | null; maxBatchFiles: number },
): Promise<FileQuota> {
  try {
    const usage = await driveUsage(ctx(actor));
    return {
      maxFileBytes: usage.maxFileBytes, maxFiles: usage.maxFiles, fileCount: usage.fileCount, usedBytes: usage.usedBytes,
      limitBytes: usage.limitBytes, target: usage.target, maxBatchFiles: limits.maxBatchFiles,
      maxConcurrentUploads: limits.maxConcurrentUploads, throttleBytesPerSecond: limits.throttleBytesPerSecond,
    };
  } catch (error) {
    throw mapError(error);
  }
}
