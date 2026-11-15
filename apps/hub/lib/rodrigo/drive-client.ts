import { createHash } from 'node:crypto';
import { z } from 'zod';
import { RodrigoResponseError, RodrigoUnavailableError, type RodrigoContext } from './service-client';
import { readJson, responseError, signedFetch, type SignedFetch } from './transport';

/**
 * Drive in Rodrigo (alignment slice 2): metadata, quota, ledger and bytes. Hub streams the
 * browser's bytes through in 8 MiB parts (one part in memory per upload) and keeps only
 * edge policy (type sniffing, upload slots, throttle). Every call carries `app:files`.
 */
const sha = z.string().regex(/^[0-9a-f]{64}$/);
export const driveFileSchema = z.object({
  folderPath: z.string().max(1024).optional(),
  id: z.string().uuid(), displayName: z.string().max(255), mime: z.string().max(127), sourceAppId: z.string().max(32),
  storedIn: z.enum(['sorye', 'drive', 'database']), status: z.enum(['uploading', 'ready', 'failed', 'deleted']),
  size: z.number().int().min(0), sha256: sha.optional(), errorCode: z.string().max(64).optional(),
  createdByUserId: z.string().max(128), createdAt: z.string(), updatedAt: z.string(), completedAt: z.string().optional(),
}).strict();
export type DriveFile = z.infer<typeof driveFileSchema>;
const sessionSchema = z.object({
  contractVersion: z.literal('2'), uploadId: z.string().uuid(), objectId: z.string().uuid(), partBytes: z.number().int().positive(),
  partCount: z.number().int().positive(), expiresAt: z.string(), target: z.enum(['sorye', 'drive', 'database']).optional(),
  uploadedParts: z.array(z.object({ partNumber: z.number().int().positive(), sha256: sha })).max(256),
}).strict();
const fileReply = z.object({ contractVersion: z.literal('2'), file: driveFileSchema }).strict();
const partSchema = z.object({ contractVersion: z.literal('2'), partNumber: z.number().int(), sha256: sha, size: z.number().int() }).strict();
const usageSchema = z.object({
  contractVersion: z.literal('2'), target: z.enum(['sorye', 'drive', 'database']), limitBytes: z.number().int().nullable(),
  usedBytes: z.number().int(), fileCount: z.number().int(), maxFiles: z.number().int(), maxFileBytes: z.number().int(),
}).strict();
export type DriveUsage = z.infer<typeof usageSchema>;

const FILES = ['files'];
const PART_ATTEMPTS = 5;

/** A rejected upload with the Rodrigo machine code (e.g. `quota_exceeded`, `integrity_failed`). */
export class DriveUploadError extends Error {
  constructor(readonly code: string, readonly status: number) { super(`Drive upload failed (${code}).`); }
}

export interface DriveUploadMeta {
  folderPath?: string;
  fileId: string; displayName: string; mime: string; sourceAppId: string;
  /** Exact size when known, else an upper bound and the size is given at completion. */
  size?: number; maxBytes?: number; sha256?: string;
}

async function call<T>(context: RodrigoContext, method: string, path: string, scope: string, schema: z.ZodType<T>, body?: unknown, timeoutMs?: number): Promise<T> {
  const response = await signedFetch({ context, method, path, scope, appScopes: FILES, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(timeoutMs ? { timeoutMs } : {}) });
  return readJson(response, schema, 1_048_576);
}

/**
 * Streams `source` into a Drive file. `finalSha256` is called after the source ends and may
 * return the browser's digest when it arrived after the bytes (multipart field order).
 * The bytes Hub received are hashed here: a mismatch with the browser digest is
 * `checksum_mismatch`; Rodrigo's read-back check reports `integrity_failed`.
 */
export async function uploadDriveFile(
  context: RodrigoContext,
  meta: DriveUploadMeta,
  source: AsyncIterable<Uint8Array>,
  options: { finalSha256?: () => string | undefined | Promise<string | undefined>; onPart?: (bytesSent: number) => void; shareHash?: string } = {},
): Promise<DriveFile> {
  const send = (input: SignedFetch) => {
    if (!options.shareHash) return signedFetch(input);
    let path = input.path.replace('/v2/files/uploads', '/v2/public-drive/uploads');
    path = path.replace(/^\/v2\/objects\/uploads\/([^/]+)\/parts\/(\d+)$/, '/v2/public-drive/parts/$1/$2');
    path = path.replace(/^\/v2\/public-drive\/uploads\/([^/]+)\/complete$/, '/v2/public-drive/complete/$1');
    return signedFetch({ ...input, path, scope: 'drive-share:access', context: { userId: 'rodrigo-drive-recipient', workspaceId: 'rodrigo-public-drive' }, actionScopes: [`share:${options.shareHash}`] });
  };
  const uploadCall = async <T,>(method: string, path: string, schema: z.ZodType<T>, body: unknown, timeoutMs?: number) =>
    readJson(await send({ context, method, path, scope: 'files:write', appScopes: FILES, body: JSON.stringify(body), timeoutMs }), schema, 1_048_576);
  let session: z.infer<typeof sessionSchema>;
  try {
    session = await uploadCall('POST', '/v2/files/uploads', sessionSchema, {
      fileId: meta.fileId, displayName: meta.displayName, mime: meta.mime, sourceAppId: meta.sourceAppId,
      folderPath: meta.folderPath ?? '',
      ...(meta.size !== undefined ? { size: meta.size } : { maxBytes: meta.maxBytes }), ...(meta.sha256 ? { sha256: meta.sha256 } : {}),
    });
  } catch (error) {
    if (error instanceof RodrigoResponseError) throw new DriveUploadError(error.code, error.status);
    throw error;
  }
  const stored = new Map(session.uploadedParts.map((part) => [part.partNumber, part.sha256]));
  const whole = createHash('sha256');
  let received = 0;
  let partNumber = 1;
  let pending: Buffer[] = [];
  let pendingSize = 0;
  const abort = async (code: string, status = 422): Promise<never> => {
    await send({ context, method: 'DELETE', path: `/v2/files/uploads/${meta.fileId}`, scope: 'files:write', appScopes: FILES })
      .then((r) => r.body?.cancel()).catch(() => undefined);
    throw new DriveUploadError(code, status);
  };
  const flush = async () => {
    const digest = createHash('sha256');
    for (const chunk of pending) digest.update(chunk);
    const partSha = digest.digest('hex');
    if (stored.get(partNumber) !== partSha) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await send({
            context, method: 'PUT', path: `/v2/objects/uploads/${session.uploadId}/parts/${partNumber}`, scope: 'objects:write',
            appScopes: FILES, body: pending, bodySha256: partSha, timeoutMs: 30_000,
          });
          await readJson(response, partSchema);
          break;
        } catch (error) {
          if (error instanceof RodrigoResponseError && error.code === 'checksum_mismatch') await abort('checksum_mismatch');
          const retryable = error instanceof RodrigoUnavailableError || (error instanceof RodrigoResponseError && (error.status === 429 || error.status === 503));
          if (!retryable || attempt >= PART_ATTEMPTS - 1) throw error;
          await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt * (0.5 + Math.random())));
        }
      }
    }
    options.onPart?.(received);
    partNumber += 1;
    pending = [];
    pendingSize = 0;
  };
  const bound = meta.size ?? meta.maxBytes ?? 0;
  for await (const value of source) {
    let chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    received += chunk.length;
    if (received > bound) await abort('too_large', 413);
    whole.update(chunk);
    while (chunk.length > 0) {
      const take = chunk.subarray(0, session.partBytes - pendingSize);
      pending.push(Buffer.from(take));
      pendingSize += take.length;
      chunk = chunk.subarray(take.length);
      // Keep the last (possibly full) part until the source ends so a digest mismatch is
      // caught before it is sent.
      if (pendingSize === session.partBytes) await flush();
    }
  }
  const digest = whole.digest('hex');
  const browser = meta.sha256 ?? (await options.finalSha256?.());
  if ((meta.size !== undefined && received !== meta.size) || (browser && browser !== digest)) await abort('checksum_mismatch');
  if (pendingSize > 0 || partNumber === 1) await flush();
  try {
    const done = await uploadCall('POST', `/v2/files/uploads/${meta.fileId}/complete`, fileReply, { size: received, sha256: digest }, 300_000);
    return done.file;
  } catch (error) {
    if (error instanceof RodrigoResponseError) throw new DriveUploadError(error.code, error.status);
    throw error;
  }
}

export async function listDriveFiles(context: RodrigoContext): Promise<DriveFile[]> {
  return (await call(context, 'GET', '/v2/files', 'files:read', z.object({ contractVersion: z.literal('2'), files: z.array(driveFileSchema) }).strict())).files;
}
export async function listDriveFolders(context: RodrigoContext): Promise<string[]> {
  const response = await signedFetch({ context, method: 'GET', path: '/v2/files-folders', scope: 'files:read', appScopes: FILES });
  return (await readJson(response, z.object({ paths: z.array(z.string().max(1024)).max(2000) }).strict(), 4_194_304)).paths;
}
export async function createDriveFolder(context: RodrigoContext, path: string): Promise<void> {
  await call(context, 'POST', '/v2/files-folders', 'files:write', z.object({ path: z.string() }).strict(), { path });
}
export async function getDriveFile(context: RodrigoContext, fileId: string): Promise<DriveFile> {
  return (await call(context, 'GET', `/v2/files/${encodeURIComponent(fileId)}`, 'files:read', fileReply)).file;
}
export async function renameDriveFile(context: RodrigoContext, fileId: string, displayName: string): Promise<DriveFile> {
  return (await call(context, 'PATCH', `/v2/files/${encodeURIComponent(fileId)}`, 'files:write', fileReply, { displayName })).file;
}
export async function deleteDriveFile(context: RodrigoContext, fileId: string): Promise<void> {
  const response = await signedFetch({ context, method: 'DELETE', path: `/v2/files/${encodeURIComponent(fileId)}`, scope: 'files:write', appScopes: FILES, timeoutMs: 30_000 });
  if (!response.ok) await responseError(response);
  await response.body?.cancel();
}
/** Streamed bytes; the caller pipes `body` to the browser or cancels it. */
export async function openDriveContent(context: RodrigoContext, fileId: string, range?: string): Promise<Response> {
  const response = await signedFetch({
    context, method: 'GET', path: `/v2/files/${encodeURIComponent(fileId)}/content`, scope: 'files:read', appScopes: FILES,
    headers: range && /^bytes=\d*-\d*$/.test(range) ? { Range: range } : {}, streamResponse: true, timeoutMs: 15_000,
  });
  if (!response.ok) await responseError(response);
  return response;
}
export async function driveUsage(context: RodrigoContext): Promise<DriveUsage> {
  return call(context, 'GET', '/v2/files-usage', 'files:read', usageSchema);
}
export async function driveLedger(context: RodrigoContext, limit = 25): Promise<DriveFile[]> {
  return (await call(context, 'GET', `/v2/files-ledger/${limit}`, 'files:read', z.object({ contractVersion: z.literal('2'), uploads: z.array(driveFileSchema) }).strict())).uploads;
}
/** Ledger row for an upload refused at the Hub edge (blocked type, too large). Best effort. */
export async function recordDriveRejection(context: RodrigoContext, input: { fileId: string; displayName: string; sourceAppId: string; code: string }): Promise<void> {
  const response = await signedFetch({ context, method: 'POST', path: '/v2/files-rejections', scope: 'files:write', appScopes: FILES, body: JSON.stringify(input) });
  await response.body?.cancel();
}
