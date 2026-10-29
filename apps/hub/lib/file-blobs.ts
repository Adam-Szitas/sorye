import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { createHash } from 'node:crypto';

let client: S3Client | undefined;
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
  return { driver, bucket: bucket!, client: client! };
}

function key(workspaceId: string, id: string) {
  if (![workspaceId, id].every(s => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(s))) {
    throw new Error('Invalid blob identity');
  }
  return `files/${workspaceId}/${id}`;
}

export async function putFileBlob(workspaceId: string, id: string, bytes: Buffer, mime: string) {
  const c = config(); const objectKey = key(workspaceId, id);
  if (c.driver === 's3') {
    await c.client.send(new PutObjectCommand({ Bucket: c.bucket, Key: objectKey, Body: bytes,
      ContentType: mime, ContentLength: bytes.length }), { abortSignal: AbortSignal.timeout(120_000) });
    return;
  }
  const target = path.join(process.cwd(), '.data', objectKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
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
