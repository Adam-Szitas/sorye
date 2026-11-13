import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { createHash } from 'node:crypto';

let client: S3Client | undefined;
let testClient: Pick<S3Client, 'send'> | undefined;

/** Tests only: route S3 calls to a fake client. */
export function setFileBlobClientForTests(fake: Pick<S3Client, 'send'> | undefined) { testClient = fake; }

/** The stored bytes did not hash to the SHA-256 of the bytes Hub received. */
export class BlobIntegrityError extends Error {
  constructor(readonly stage: 'write' | 'readback') {
    super('Stored file does not match the uploaded bytes');
    this.name = 'BlobIntegrityError';
  }
}

/** Optional full read-back after every store; off by default because it doubles storage reads. */
export function readbackVerificationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FILE_UPLOAD_VERIFY_READBACK === 'true';
}

function config() {
  const driver = process.env.FILE_STORE_DRIVER ?? 'local';
  if (driver !== 's3' && driver !== 'local') throw new Error('Invalid FILE_STORE_DRIVER');
  if (process.env.NODE_ENV === 'production' && driver !== 's3') {
    throw new Error('Production file storage requires FILE_STORE_DRIVER=s3');
  }
  const bucket = process.env.FILE_S3_BUCKET;
  if (driver === 's3' && !bucket) throw new Error('FILE_S3_BUCKET is required');
  if (driver === 's3' && !client) client = new S3Client({
    region: process.env.FILE_S3_REGION ?? 'auto',
    endpoint: process.env.FILE_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.FILE_S3_PATH_STYLE === 'true',
    maxAttempts: 3,
  });
  return { driver, bucket: bucket!, client: (testClient ?? client!) as S3Client };
}

function key(workspaceId: string, id: string) {
  if (![workspaceId, id].every(s => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(s))) {
    throw new Error('Invalid blob identity');
  }
  return `files/${workspaceId}/${id}`;
}

/**
 * Store a blob and prove the stored copy is the bytes Hub received.
 * - S3: the request carries `ChecksumSHA256`; the object store recomputes it and
 *   refuses the write on a mismatch (`BadDigest`), and the response echoes it.
 *   No second transfer is needed.
 * - Local disk: the written file is read back and hashed.
 * - `FILE_UPLOAD_VERIFY_READBACK=true` adds a full S3 read-back as well.
 * On a mismatch the blob is deleted and `BlobIntegrityError` is thrown.
 */
export async function putFileBlob(workspaceId: string, id: string, bytes: Buffer, mime: string, sha256?: string) {
  const c = config(); const objectKey = key(workspaceId, id);
  const expected = sha256 ?? createHash('sha256').update(bytes).digest('hex');
  if (c.driver === 's3') {
    const checksum = Buffer.from(expected, 'hex').toString('base64');
    let echoed: string | undefined;
    try {
      const result = await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: objectKey, Body: bytes,
        ContentType: mime, ContentLength: bytes.length, ChecksumAlgorithm: 'SHA256', ChecksumSHA256: checksum,
        Metadata: { sha256: expected } }), { abortSignal: AbortSignal.timeout(120_000) });
      echoed = result?.ChecksumSHA256;
    } catch (error) {
      if (error && typeof error === 'object' && (error as { name?: string }).name === 'BadDigest') {
        throw new BlobIntegrityError('write');
      }
      throw error;
    }
    if (echoed && echoed !== checksum) {
      await deleteFileBlob(workspaceId, id).catch(() => undefined);
      throw new BlobIntegrityError('write');
    }
    if (readbackVerificationEnabled() && (await hashFileBlob(workspaceId, id)) !== expected) {
      await deleteFileBlob(workspaceId, id).catch(() => undefined);
      throw new BlobIntegrityError('readback');
    }
    return;
  }
  const target = path.join(process.cwd(), '.data', objectKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  if ((await hashFileBlob(workspaceId, id)) !== expected) {
    await deleteFileBlob(workspaceId, id).catch(() => undefined);
    throw new BlobIntegrityError('readback');
  }
}

/** SHA-256 of a stored blob, streamed so the file is never fully buffered. */
export async function hashFileBlob(workspaceId: string, id: string): Promise<string> {
  const hash = createHash('sha256');
  const reader = (await streamFileBlob(workspaceId, id)).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return hash.digest('hex');
}

/** Stream an existing local blob during migration; never buffer the file in memory. */
export async function migrateFileBlobStream(input: {
  workspaceId: string; id: string; sourcePath: string; size: number; mime: string;
}) {
  const c = config();
  if (c.driver !== 's3') throw new Error('Blob migration target must be S3');
  const objectKey = key(input.workspaceId, input.id);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(input.sourcePath)) hash.update(chunk as Buffer);
  const sha256 = hash.digest('hex');
  try {
    const current = await c.client.send(new HeadObjectCommand({ Bucket: c.bucket, Key: objectKey }),
      { abortSignal: AbortSignal.timeout(30_000) });
    if (current.ContentLength === input.size && current.Metadata?.sha256 === sha256) return 'exists' as const;
    throw new Error(`Target object exists but does not match source: ${objectKey}`);
  } catch (error) {
    if (!(error && typeof error === 'object' && '$metadata' in error &&
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)) throw error;
  }
  await c.client.send(new PutObjectCommand({
    Bucket: c.bucket, Key: objectKey, Body: createReadStream(input.sourcePath),
    ContentType: input.mime, ContentLength: input.size, IfNoneMatch: '*', Metadata: { sha256 },
  }), { abortSignal: AbortSignal.timeout(120_000) });
  return 'uploaded' as const;
}

export async function streamFileBlob(workspaceId: string, id: string): Promise<ReadableStream<Uint8Array>> {
  const c = config(); const objectKey = key(workspaceId, id);
  if (c.driver === 's3') {
    const result = await c.client.send(new GetObjectCommand({ Bucket: c.bucket, Key: objectKey }),
      { abortSignal: AbortSignal.timeout(120_000) });
    if (!result.Body) throw new Error('Missing file body');
    return result.Body.transformToWebStream();
  }
  return Readable.toWeb(createReadStream(path.join(process.cwd(), '.data', objectKey))) as ReadableStream<Uint8Array>;
}

export async function deleteFileBlob(workspaceId: string, id: string) {
  const c = config(); const objectKey = key(workspaceId, id);
  if (c.driver === 's3') {
    await c.client.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: objectKey }),
      { abortSignal: AbortSignal.timeout(30_000) });
  } else {
    await unlink(path.join(process.cwd(), '.data', objectKey)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
}
