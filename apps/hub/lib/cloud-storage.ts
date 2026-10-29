import { randomUUID } from 'crypto';
import {
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type {
  CloudStorageConnection,
  CloudStorageObject,
  CloudStorageProvider,
} from '@sorye/types';
import { decryptStorageSecret, encryptStorageSecret } from '@/lib/storage-crypto';
import { jsonDataFile } from '@/lib/store/json-file';

interface StorageRecord extends CloudStorageConnection {
  workspaceId: string;
  accessKeyEncrypted: string;
  secretKeyEncrypted: string;
}

type StorageStore = Record<string, StorageRecord[]>;
const storageFile = jsonDataFile<StorageStore>('relay-storages.json', () => ({}));
const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

export class CloudStorageError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'CloudStorageError';
  }
}

function safeRecord(record: StorageRecord): CloudStorageConnection {
  return {
    id: record.id,
    name: record.name,
    provider: record.provider,
    bucket: record.bucket,
    region: record.region,
    ...(record.accountId ? { accountId: record.accountId } : {}),
    accessKeyHint: record.accessKeyHint,
    createdAt: record.createdAt,
  };
}

function validateName(name: unknown): string {
  if (typeof name !== 'string') throw new CloudStorageError('Enter a folder name.');
  const value = name.trim();
  if (!value || value.length > 60 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new CloudStorageError('Folder name must be 1–60 characters.');
  }
  return value;
}

function validateBucket(value: unknown): string {
  if (typeof value !== 'string') throw new CloudStorageError('Enter a valid bucket name.');
  const bucket = value.trim();
  if (bucket.length < 3 || bucket.length > 63 ||
      !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) ||
      bucket.includes('..') || bucket.includes('.-') || bucket.includes('-.') ||
      /\d+\.\d+\.\d+\.\d+/.test(bucket)) {
    throw new CloudStorageError('Bucket name is invalid.');
  }
  return bucket;
}

function validateCredentials(value: unknown, label: string): string {
  if (typeof value !== 'string' || value !== value.trim() || value.length < 8 || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new CloudStorageError(`${label} is invalid.`);
  }
  return value;
}

function validateRegion(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(value.trim())) {
    throw new CloudStorageError('Choose a valid AWS region.');
  }
  return value.trim();
}

function validateAccountId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/i.test(value.trim())) {
    throw new CloudStorageError('Cloudflare account ID must contain 32 hexadecimal characters.');
  }
  return value.trim();
}

function providerConfig(record: Pick<StorageRecord, 'provider' | 'region' | 'accountId' | 'bucket'>) {
  if (record.provider === 'cloudflare-r2') {
    return {
      region: 'auto',
      endpoint: `https://${record.accountId}.r2.cloudflarestorage.com`,
    };
  }
  return {
    region: record.region,
    endpoint: `https://s3.${record.region}.amazonaws.com`,
  };
}

async function withClient<T>(workspaceId: string, storageId: string, action: (client: S3Client, record: StorageRecord) => Promise<T>): Promise<T> {
  const record = await findStorageRecord(workspaceId, storageId);
  const credentials = {
    accessKeyId: decryptStorageSecret(record.accessKeyEncrypted),
    secretAccessKey: decryptStorageSecret(record.secretKeyEncrypted),
  };
  const client = new S3Client({
    ...providerConfig(record),
    credentials,
    forcePathStyle: true,
    maxAttempts: 2,
  });
  try {
    return await action(client, record);
  } catch (error) {
    if (error instanceof CloudStorageError) throw error;
    // SDK exceptions can contain request details; keep provider messages out of API responses.
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new CloudStorageError('Cloud storage did not respond in time. Try again.', 504);
    }
    throw new CloudStorageError('Cloud storage request failed. Check the connection and try again.', 502);
  } finally {
    client.destroy();
  }
}

async function findStorageRecord(workspaceId: string, storageId: string): Promise<StorageRecord> {
  const records = (await storageFile.read(workspaceId))[workspaceId] ?? [];
  const record = records.find((entry) => entry.id === storageId);
  if (!record) throw new CloudStorageError('Storage connection not found.', 404);
  return record;
}

export async function listCloudStorages(workspaceId: string): Promise<CloudStorageConnection[]> {
  const records = (await storageFile.read(workspaceId))[workspaceId] ?? [];
  return records.map(safeRecord);
}

export async function connectCloudStorage(input: {
  workspaceId: string;
  provider: unknown;
  name: unknown;
  bucket: unknown;
  region?: unknown;
  accountId?: unknown;
  accessKeyId: unknown;
  secretAccessKey: unknown;
}): Promise<CloudStorageConnection> {
  if (input.provider !== 'aws-s3' && input.provider !== 'cloudflare-r2') {
    throw new CloudStorageError('Choose AWS S3 or Cloudflare R2.');
  }
  const provider: CloudStorageProvider = input.provider;
  const name = validateName(input.name);
  const bucket = validateBucket(input.bucket);
  const region = provider === 'aws-s3' ? validateRegion(input.region) : 'auto';
  const accountId = provider === 'cloudflare-r2' ? validateAccountId(input.accountId) : undefined;
  const accessKeyId = validateCredentials(input.accessKeyId, 'Access key ID');
  const secretAccessKey = validateCredentials(input.secretAccessKey, 'Secret access key');
  if (!process.env.STORAGE_SECRET_KEY || process.env.STORAGE_SECRET_KEY.trim().length < 32) {
    throw new CloudStorageError('Cloud storage is not enabled yet. Ask your Sorye administrator to configure STORAGE_SECRET_KEY.', 503);
  }

  const record: StorageRecord = {
    id: randomUUID(), workspaceId: input.workspaceId, name, provider, bucket, region, accountId,
    accessKeyHint: accessKeyId.slice(-4),
    accessKeyEncrypted: encryptStorageSecret(accessKeyId),
    secretKeyEncrypted: encryptStorageSecret(secretAccessKey),
    createdAt: new Date().toISOString(),
  };
  const client = new S3Client({
    ...providerConfig(record),
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    maxAttempts: 1,
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS) });
  } catch {
    client.destroy();
    throw new CloudStorageError('Could not access this bucket. Check the provider, bucket, region, and read permissions.', 400);
  }
  client.destroy();

  await storageFile.update((store) => {
    const records = store[input.workspaceId] ?? [];
    if (records.length >= 10) throw new CloudStorageError('A workspace can connect up to 10 storage accounts.', 400);
    if (records.some((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new CloudStorageError('A storage folder with this name already exists.', 409);
    }
    records.unshift(record);
    store[input.workspaceId] = records;
  }, input.workspaceId);
  return safeRecord(record);
}

export async function getCloudStorageSecrets(workspaceId: string, storageId: string) {
  const record = await findStorageRecord(workspaceId, storageId);
  return {
    accessKeyId: decryptStorageSecret(record.accessKeyEncrypted),
    secretAccessKey: decryptStorageSecret(record.secretKeyEncrypted),
  };
}

export async function rotateCloudStorageCredentials(workspaceId: string, storageId: string, accessKeyRaw: unknown, secretKeyRaw: unknown): Promise<void> {
  const record = await findStorageRecord(workspaceId, storageId);
  const accessKeyId = validateCredentials(accessKeyRaw, 'Access key ID');
  const secretAccessKey = validateCredentials(secretKeyRaw, 'Secret access key');
  const client = new S3Client({
    ...providerConfig(record),
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    maxAttempts: 1,
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: record.bucket }), { abortSignal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS) });
  } catch {
    throw new CloudStorageError('Could not verify these credentials for the connected bucket.', 400);
  } finally {
    client.destroy();
  }
  await storageFile.update((store) => {
    const records = store[workspaceId] ?? [];
    const index = records.findIndex((entry) => entry.id === storageId);
    if (index < 0) throw new CloudStorageError('Storage connection not found.', 404);
    records[index] = {
      ...records[index]!,
      accessKeyHint: accessKeyId.slice(-4),
      accessKeyEncrypted: encryptStorageSecret(accessKeyId),
      secretKeyEncrypted: encryptStorageSecret(secretAccessKey),
    };
    store[workspaceId] = records;
  }, workspaceId);
}

export async function deleteCloudStorage(workspaceId: string, storageId: string): Promise<void> {
  const record = await findStorageRecord(workspaceId, storageId);
  await storageFile.update((store) => {
    store[workspaceId] = (store[workspaceId] ?? []).filter((entry) => entry.id !== record.id);
  }, workspaceId);
}

function validatePrefix(prefix: unknown): string {
  if (typeof prefix !== 'string' || prefix.length > 1024 || /[\u0000-\u001f\u007f]/.test(prefix) || prefix.startsWith('/') || prefix.split('/').includes('..')) {
    throw new CloudStorageError('Folder path is invalid.');
  }
  return prefix;
}

export async function listCloudStorageObjects(workspaceId: string, storageId: string, rawPrefix = ''): Promise<CloudStorageObject[]> {
  const prefix = validatePrefix(rawPrefix);
  return withClient(workspaceId, storageId, async (client, record) => {
    const folders: CloudStorageObject[] = [];
    const objects: CloudStorageObject[] = [];
    let continuationToken: string | undefined;
    const signal = AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS);
    // Bound each view to 5,000 entries to limit provider and Hub memory use.
    for (let page = 0; page < 10; page += 1) {
      const result = await client.send(new ListObjectsV2Command({
        Bucket: record.bucket, Prefix: prefix, Delimiter: '/', MaxKeys: 500, ContinuationToken: continuationToken,
      }), { abortSignal: signal });
      folders.push(...(result.CommonPrefixes ?? []).flatMap(({ Prefix }) => Prefix ? [{
        key: Prefix,
        name: Prefix.slice(prefix.length).replace(/\/$/, ''),
        size: 0,
        lastModified: null,
        isFolder: true,
      }] : []));
      objects.push(...(result.Contents ?? []).flatMap((object) => {
        if (!object.Key || object.Key === prefix || object.Key.endsWith('/')) return [];
        return [{ key: object.Key, name: object.Key.slice(prefix.length), size: object.Size ?? 0,
          lastModified: object.LastModified?.toISOString() ?? null, isFolder: false }];
      }));
      continuationToken = result.NextContinuationToken;
      if (!result.IsTruncated || !continuationToken || folders.length + objects.length >= 5_000) break;
    }
    return [...folders, ...objects].slice(0, 5_000);
  });
}

export async function putCloudStorageObject(workspaceId: string, storageId: string, rawKey: string, bytes: Buffer, contentType: string): Promise<void> {
  const key = validateObjectKey(rawKey);
  await withClient(workspaceId, storageId, async (client, record) => {
    await client.send(new PutObjectCommand({ Bucket: record.bucket, Key: key, Body: bytes, ContentType: contentType }), { abortSignal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS) });
  });
}

export async function getCloudStorageObject(workspaceId: string, storageId: string, rawKey: string) {
  const key = validateObjectKey(rawKey);
  return withClient(workspaceId, storageId, async (client, record) => {
    const result = await client.send(new GetObjectCommand({ Bucket: record.bucket, Key: key }), { abortSignal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS) });
    const size = result.ContentLength ?? 0;
    if (size > 64 * 1024 * 1024) throw new CloudStorageError('This file is larger than Drive can download (64 MB).', 413);
    if (!result.Body) throw new CloudStorageError('File is empty or unavailable.', 404);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      const bytes = Buffer.from(chunk);
      total += bytes.length;
      if (total > 64 * 1024 * 1024) throw new CloudStorageError('This file is larger than Drive can download (64 MB).', 413);
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks, total);
    return { bytes, contentType: result.ContentType ?? 'application/octet-stream' };
  });
}

function validateObjectKey(key: unknown): string {
  if (typeof key !== 'string' || !key || key.length > 1024 || key.startsWith('/') || /[\u0000-\u001f\u007f]/.test(key) || key.split('/').includes('..')) {
    throw new CloudStorageError('File path is invalid.');
  }
  return key;
}
