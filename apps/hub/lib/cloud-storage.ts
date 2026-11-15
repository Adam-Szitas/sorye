import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CloudStorageConnection, CloudStorageObject } from '@sorye/types';
import { ObjectUploadError, uploadObject } from '@/lib/rodrigo/objects-client';
import { RodrigoResponseError, RodrigoUnavailableError, type RodrigoContext } from '@/lib/rodrigo/service-client';
import { readJson, responseError, signedFetch } from '@/lib/rodrigo/transport';

/**
 * Relay cloud folders (alignment slice 2). Rodrigo owns the connections and the sealed
 * credentials, lists and reads objects, and copies uploads into the customer's bucket.
 * Hub keeps the edge checks (rate limits, names, types) and streams bytes; it holds no keys.
 */
export class CloudStorageError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'CloudStorageError';
  }
}

const SCOPES = ['relay'];
const connectionSchema = z.object({
  id: z.string().uuid(), name: z.string(), provider: z.enum(['aws-s3', 'cloudflare-r2']), bucket: z.string(), region: z.string(),
  accountId: z.string().optional(), accessKeyHint: z.string(), createdAt: z.string(),
}).strict();
const objectSchema = z.object({ key: z.string(), name: z.string(), size: z.number(), lastModified: z.string().nullable(), isFolder: z.boolean() }).strict();

const MESSAGES: Record<string, [string, number]> = {
  invalid_input: ['Check the provider, bucket, region and keys.', 400],
  invalid_provider: ['Choose AWS S3 or Cloudflare R2.', 400],
  bucket_unreachable: ['Could not access this bucket. Check the provider, bucket, region, and read permissions.', 400],
  too_many_storages: ['A workspace can connect up to 10 storage accounts.', 400],
  name_taken: ['A storage folder with this name already exists.', 409],
  not_found: ['Storage connection not found.', 404],
  invalid_path: ['Folder path is invalid.', 400],
  too_large: ['This file is larger than Drive can download (64 MB).', 413],
  provider_timeout: ['Cloud storage did not respond in time. Try again.', 504],
  encryption_unavailable: ['Cloud storage is not enabled yet. Ask your Sorye administrator.', 503],
  admin_required: ['Only Sorye admins can reveal storage credentials.', 403],
};
function mapped(error: unknown): CloudStorageError {
  if (error instanceof CloudStorageError) return error;
  if (error instanceof RodrigoResponseError) {
    const known = MESSAGES[error.code];
    if (known) return new CloudStorageError(known[0], known[1]);
    return new CloudStorageError('Cloud storage request failed. Check the connection and try again.', 502);
  }
  if (error instanceof RodrigoUnavailableError) return new CloudStorageError('Cloud storage is temporarily unavailable.', 503);
  return new CloudStorageError('Cloud storage request failed. Check the connection and try again.', 502);
}
const hex = (text: string) => (text ? Buffer.from(text, 'utf8').toString('hex') : '-');

async function call<T>(actor: RodrigoContext, method: string, path: string, schema: z.ZodType<T>, body?: unknown, timeoutMs = 45_000): Promise<T> {
  try {
    const response = await signedFetch({
      context: actor, method, path, scope: method === 'GET' ? 'cloud:read' : 'cloud:write', appScopes: SCOPES,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), timeoutMs,
    });
    return await readJson(response, schema, 4_194_304);
  } catch (error) {
    throw mapped(error);
  }
}
async function noContent(actor: RodrigoContext, method: string, path: string, body?: unknown): Promise<void> {
  try {
    const response = await signedFetch({ context: actor, method, path, scope: 'cloud:write', appScopes: SCOPES, ...(body === undefined ? {} : { body: JSON.stringify(body) }), timeoutMs: 45_000 });
    if (!response.ok) await responseError(response);
    await response.body?.cancel();
  } catch (error) {
    throw mapped(error);
  }
}

export async function listCloudStorages(actor: RodrigoContext): Promise<CloudStorageConnection[]> {
  return (await call(actor, 'GET', '/v2/cloud-storages', z.object({ contractVersion: z.literal('2'), storages: z.array(connectionSchema) }).strict())).storages;
}

export async function connectCloudStorage(input: {
  actor: RodrigoContext; provider: unknown; name: unknown; bucket: unknown; region?: unknown; accountId?: unknown;
  accessKeyId: unknown; secretAccessKey: unknown;
}): Promise<CloudStorageConnection> {
  if (input.provider !== 'aws-s3' && input.provider !== 'cloudflare-r2') throw new CloudStorageError('Choose AWS S3 or Cloudflare R2.');
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return (await call(input.actor, 'POST', '/v2/cloud-storages', z.object({ contractVersion: z.literal('2'), storage: connectionSchema }).strict(), {
    name: text(input.name), provider: input.provider, bucket: text(input.bucket),
    ...(input.provider === 'aws-s3' ? { region: text(input.region) } : { accountId: text(input.accountId) }),
    accessKeyId: text(input.accessKeyId), secretAccessKey: text(input.secretAccessKey),
  })).storage;
}

/** Platform administrators only; Rodrigo checks its own identity record and audits it. */
export async function getCloudStorageSecrets(actor: RodrigoContext, storageId: string) {
  const result = await call(actor, 'POST', `/v2/cloud-storages/${encodeURIComponent(storageId)}/reveal`,
    z.object({ contractVersion: z.literal('2'), accessKeyId: z.string(), secretAccessKey: z.string() }).strict());
  return { accessKeyId: result.accessKeyId, secretAccessKey: result.secretAccessKey };
}

export async function rotateCloudStorageCredentials(actor: RodrigoContext, storageId: string, accessKeyRaw: unknown, secretKeyRaw: unknown): Promise<void> {
  await noContent(actor, 'PUT', `/v2/cloud-storages/${encodeURIComponent(storageId)}/credentials`, {
    accessKeyId: typeof accessKeyRaw === 'string' ? accessKeyRaw.trim() : '', secretAccessKey: typeof secretKeyRaw === 'string' ? secretKeyRaw.trim() : '',
  });
}

export async function deleteCloudStorage(actor: RodrigoContext, storageId: string): Promise<void> {
  await noContent(actor, 'DELETE', `/v2/cloud-storages/${encodeURIComponent(storageId)}`);
}

function validatePrefix(prefix: unknown): string {
  if (typeof prefix !== 'string' || prefix.length > 1024 || /[\u0000-\u001f\u007f]/.test(prefix) || prefix.startsWith('/') || prefix.split('/').includes('..')) {
    throw new CloudStorageError('Folder path is invalid.');
  }
  return prefix;
}
function validateObjectKey(key: unknown): string {
  if (typeof key !== 'string' || !key || key.length > 1024 || key.startsWith('/') || /[\u0000-\u001f\u007f]/.test(key) || key.split('/').includes('..')) {
    throw new CloudStorageError('File path is invalid.');
  }
  return key;
}

export async function listCloudStorageObjects(actor: RodrigoContext, storageId: string, rawPrefix = ''): Promise<CloudStorageObject[]> {
  const prefix = validatePrefix(rawPrefix);
  return (await call(actor, 'GET', `/v2/cloud-storages/${encodeURIComponent(storageId)}/objects/${hex(prefix)}`,
    z.object({ contractVersion: z.literal('2'), objects: z.array(objectSchema).max(5000) }).strict())).objects;
}
export async function createCloudStorageFolder(actor: RodrigoContext, storageId: string, path: string): Promise<void> {
  await call(actor, 'POST', `/v2/cloud-storages/${encodeURIComponent(storageId)}/folders`, z.object({ path: z.string() }).strict(), { path });
}

/**
 * Streams an upload into Rodrigo (as a verified `relay` object), then asks Rodrigo to copy
 * it into the customer's bucket at `key`.
 */
export async function putCloudStorageObject(actor: RodrigoContext, storageId: string, rawKey: string, source: AsyncIterable<Uint8Array>,
  contentType: string, bounds: { size?: number; maxBytes?: number }): Promise<{ size: number }> {
  const key = validateObjectKey(rawKey);
  const objectId = randomUUID();
  try {
    const meta = await uploadObject(actor, { objectId, purpose: 'relay', contentType, ...bounds }, source);
    await call(actor, 'POST', `/v2/cloud-storages/${encodeURIComponent(storageId)}/imports`,
      z.object({ contractVersion: z.literal('2'), key: z.string(), size: z.number(), sha256: z.string() }).strict(), { objectId, key }, 300_000);
    return { size: meta.size };
  } catch (error) {
    if (error instanceof ObjectUploadError) throw new CloudStorageError(error.code === 'object_too_large' ? 'File is too large (maximum 64 MB).' : 'The file was damaged on the way. Upload it again.', error.code === 'object_too_large' ? 413 : 422);
    throw mapped(error);
  }
}

/** Streamed download (at most 64 MiB, enforced by Rodrigo). */
export async function getCloudStorageObject(actor: RodrigoContext, storageId: string, rawKey: string) {
  const key = validateObjectKey(rawKey);
  try {
    const response = await signedFetch({
      context: actor, method: 'GET', path: `/v2/cloud-storages/${encodeURIComponent(storageId)}/object/${hex(key)}`, scope: 'cloud:read',
      appScopes: SCOPES, streamResponse: true, timeoutMs: 30_000,
    });
    if (!response.ok || !response.body) await responseError(response);
    return { body: response.body!, contentType: response.headers.get('content-type') ?? 'application/octet-stream', length: response.headers.get('content-length') };
  } catch (error) {
    throw mapped(error);
  }
}
