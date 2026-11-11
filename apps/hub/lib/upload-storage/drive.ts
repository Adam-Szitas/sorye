import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { FILE_MAX_BYTES, type OwnStorageErrorCode } from '@sorye/types';
import { guardedLookup, HostNotAllowedError, normalizeHost, resolvePublicAddress } from './net-guard';
import type { DriveConfig, DriveSecret } from './validate';

/**
 * Customer S3-compatible bucket. Every socket goes through `guardedLookup`,
 * so a host that resolves to a private address is refused even if its DNS
 * changed after the connection was saved.
 */

const REQUEST_TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 10_000;
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export class DriveError extends Error {
  constructor(readonly code: OwnStorageErrorCode) {
    super(code);
    this.name = 'DriveError';
  }
}

export function driveEndpoint(config: DriveConfig): string {
  if (config.provider === 'aws-s3') return `https://s3.${config.region}.amazonaws.com`;
  if (config.provider === 'cloudflare-r2') return `https://${config.accountId}.r2.cloudflarestorage.com`;
  if (!config.endpoint) throw new DriveError('invalid_input');
  return config.endpoint;
}

/** Object key for a Drive file: fixed by the server, never from user input. */
export function driveObjectKey(config: DriveConfig, workspaceId: string, fileId: string): string {
  if (!ID_RE.test(workspaceId) || !ID_RE.test(fileId)) throw new DriveError('invalid_input');
  return `${config.prefix}${workspaceId}/${fileId}`;
}

function client(config: DriveConfig, secret: DriveSecret, allowPrivate: boolean): S3Client {
  const lookup = guardedLookup(allowPrivate) as unknown as http.AgentOptions['lookup'];
  const generic = config.provider === 's3-compatible';
  return new S3Client({
    region: config.region,
    endpoint: driveEndpoint(config),
    forcePathStyle: config.pathStyle,
    credentials: { accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey },
    maxAttempts: 2,
    // Some S3-compatible services reject the SDK's default CRC32 trailers; Sorye checks SHA-256 itself.
    ...(generic ? { requestChecksumCalculation: 'WHEN_REQUIRED' as const, responseChecksumValidation: 'WHEN_REQUIRED' as const } : {}),
    requestHandler: {
      requestTimeout: REQUEST_TIMEOUT_MS,
      connectionTimeout: CONNECT_TIMEOUT_MS,
      httpsAgent: new https.Agent({ keepAlive: false, lookup, minVersion: 'TLSv1.2' }),
      httpAgent: new http.Agent({ keepAlive: false, lookup }),
    },
  });
}

/** Map SDK and socket failures to codes. Provider messages never leave the server. */
export function driveErrorCode(error: unknown): OwnStorageErrorCode {
  if (error instanceof DriveError) return error.code;
  if (error instanceof HostNotAllowedError) return error.reason;
  const e = error as { name?: string; code?: string; Code?: string; $metadata?: { httpStatusCode?: number }; cause?: { code?: string } };
  const code = e?.code ?? e?.cause?.code ?? '';
  const name = e?.name ?? e?.Code ?? '';
  const status = e?.$metadata?.httpStatusCode;
  if (code === 'EHOSTNOTALLOWED') return 'host_not_allowed';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'host_unresolved';
  if (/^(?:CERT_|ERR_TLS_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_SSL)/.test(code)) return 'tls_failed';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'unreachable';
  if (name === 'TimeoutError' || code === 'ETIMEDOUT' || name === 'RequestTimeout' || name === 'AbortError') return 'timeout';
  if (name === 'NoSuchBucket' || (status === 404 && name !== 'NoSuchKey')) return 'not_found';
  if (name === 'NoSuchKey') return 'not_found';
  if (name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch' || name === 'InvalidToken' || status === 401) return 'auth_failed';
  if (name === 'AccessDenied' || status === 403) return 'permission_denied';
  return 'storage_unavailable';
}

async function run<T>(config: DriveConfig, secret: DriveSecret, allowPrivate: boolean, action: (s3: S3Client) => Promise<T>): Promise<T> {
  // Resolve once up front for a clear error; the agent re-checks every socket.
  const host = normalizeHost(new URL(driveEndpoint(config)).hostname, allowPrivate);
  if (!host) throw new DriveError('invalid_input');
  await resolvePublicAddress(host, allowPrivate);
  const s3 = client(config, secret, allowPrivate);
  try {
    return await action(s3);
  } catch (error) {
    throw new DriveError(driveErrorCode(error));
  } finally {
    s3.destroy();
  }
}

async function readBody(body: unknown, limit: number): Promise<Buffer> {
  if (!body) throw new DriveError('not_found');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > limit) throw new DriveError('integrity_failed');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

/**
 * Prove the connection works before saving it: the bucket exists and Sorye
 * can write, read back and delete an object under its prefix.
 */
export async function verifyDrive(config: DriveConfig, secret: DriveSecret, allowPrivate: boolean): Promise<void> {
  await run(config, secret, allowPrivate, async (s3) => {
    const signal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    await s3.send(new HeadBucketCommand({ Bucket: config.bucket }), { abortSignal: signal() });
    const key = `${config.prefix}.sorye-connection-check/${randomUUID()}`;
    const probe = Buffer.from(`sorye connection check ${new Date().toISOString()}`);
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: probe, ContentLength: probe.length, ContentType: 'text/plain' }), { abortSignal: signal() });
    try {
      const read = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: signal() });
      const back = await readBody(read.Body, 4096);
      if (!back.equals(probe)) throw new DriveError('integrity_failed');
    } finally {
      await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: signal() }).catch(() => undefined);
    }
  });
}

export async function putDriveObject(config: DriveConfig, secret: DriveSecret, allowPrivate: boolean, key: string, bytes: Buffer, mime: string, sha256: string): Promise<void> {
  await run(config, secret, allowPrivate, async (s3) => {
    await s3.send(new PutObjectCommand({
      Bucket: config.bucket, Key: key, Body: bytes, ContentLength: bytes.length, ContentType: mime,
      Metadata: { sha256 },
    }), { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 2) });
  });
}

/** Bytes of one object, at most `FILE_MAX_BYTES`. The caller checks size and SHA-256 against the ledger. */
export async function getDriveObject(config: DriveConfig, secret: DriveSecret, allowPrivate: boolean, key: string): Promise<Buffer> {
  return run(config, secret, allowPrivate, async (s3) => {
    const result = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 2) });
    if ((result.ContentLength ?? 0) > FILE_MAX_BYTES) throw new DriveError('integrity_failed');
    return readBody(result.Body, FILE_MAX_BYTES);
  });
}

export async function deleteDriveObject(config: DriveConfig, secret: DriveSecret, allowPrivate: boolean, key: string): Promise<void> {
  await run(config, secret, allowPrivate, async (s3) => {
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  });
}
