import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  RODRIGO_OBJECT_MAX_BYTES, RODRIGO_OBJECT_PURPOSES,
  type RodrigoCreateUpload, type RodrigoObjectMeta, type RodrigoObjectPurpose, type RodrigoUploadSession,
} from '@sorye/types';
import { RodrigoResponseError, RodrigoUnavailableError, type RodrigoContext } from './service-client';
import { readJson, responseError, signedFetch } from './transport';

/**
 * Streamed object storage in Rodrigo. Hub holds at most one part (8 MiB) per upload in
 * memory: bytes flow browser → Hub → Rodrigo → object store. The browser's SHA-256 is
 * checked by Hub over the received bytes, by Rodrigo per part, and by Rodrigo again over
 * the stored object before it becomes visible.
 */
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const sessionSchema: z.ZodType<RodrigoUploadSession> = z.object({
  contractVersion: z.literal('2'), uploadId: z.string().uuid(), objectId: z.string().uuid(),
  partBytes: z.number().int().positive(), partCount: z.number().int().positive(), expiresAt: z.string().max(64),
  uploadedParts: z.array(z.object({ partNumber: z.number().int().positive(), sha256: sha })).max(256),
}).strict();
const metaSchema: z.ZodType<RodrigoObjectMeta> = z.object({
  contractVersion: z.literal('2'), objectId: z.string().uuid(), purpose: z.enum(RODRIGO_OBJECT_PURPOSES),
  size: z.number().int().min(0), sha256: sha, contentType: z.string().max(127), status: z.literal('ready'), createdAt: z.string().max(64),
}).strict();
const partSchema = z.object({ contractVersion: z.literal('2'), partNumber: z.number().int(), sha256: sha, size: z.number().int() }).strict();

/** A rejected upload. `checksum_mismatch` / `integrity_failed` mean damaged bytes were refused. */
export class ObjectUploadError extends Error {
  constructor(readonly code: string, readonly status = 422) { super(`Object upload failed (${code}).`); }
}

const PART_ATTEMPTS = 5;

export interface UploadProgress { bytesSent: number; partsSent: number; partCount: number }

function base(meta: RodrigoCreateUpload) {
  if (!RODRIGO_OBJECT_PURPOSES.includes(meta.purpose)) throw new ObjectUploadError('invalid_purpose', 400);
  if (!Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > RODRIGO_OBJECT_MAX_BYTES) throw new ObjectUploadError('object_too_large', 413);
  if (!sha.safeParse(meta.sha256).success) throw new ObjectUploadError('invalid_sha256', 400);
}

export async function createObjectUpload(context: RodrigoContext, meta: RodrigoCreateUpload): Promise<RodrigoUploadSession> {
  base(meta);
  const response = await signedFetch({
    context, method: 'POST', path: '/v2/objects/uploads', scope: 'objects:write', appScopes: [meta.purpose],
    body: JSON.stringify(meta), headers: { 'If-None-Match': '*' },
  });
  return readJson(response, sessionSchema);
}

export async function abortObjectUpload(context: RodrigoContext, purpose: RodrigoObjectPurpose, uploadId: string): Promise<void> {
  const response = await signedFetch({ context, method: 'DELETE', path: `/v2/objects/uploads/${encodeURIComponent(uploadId)}`, scope: 'objects:write', appScopes: [purpose] });
  if (!response.ok && response.status !== 404) await responseError(response);
  await response.body?.cancel();
}

/**
 * Uploads `source` as an immutable object. The declared size and SHA-256 must match the
 * bytes; otherwise the upload is aborted and `checksum_mismatch` is thrown. Resumes an
 * open session with the same id and metadata, skipping parts Rodrigo already holds.
 */
export async function uploadObject(
  context: RodrigoContext,
  meta: RodrigoCreateUpload,
  source: AsyncIterable<Uint8Array>,
  options: { onProgress?: (progress: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<RodrigoObjectMeta> {
  const session = await createObjectUpload(context, meta);
  const stored = new Map(session.uploadedParts.map((part) => [part.partNumber, part.sha256]));
  const whole = createHash('sha256');
  let received = 0;
  let partNumber = 1;
  let bytesSent = 0;
  let pending: Buffer[] = [];
  let pendingSize = 0;
  const fail = async (code: string): Promise<never> => {
    await abortObjectUpload(context, meta.purpose, session.uploadId).catch(() => undefined);
    throw new ObjectUploadError(code);
  };
  const flush = async () => {
    const digest = createHash('sha256');
    for (const chunk of pending) digest.update(chunk);
    const partSha = digest.digest('hex');
    if (stored.get(partNumber) !== partSha) {
      // A part PUT is idempotent (same number, same bytes), so overload and transport
      // failures are retried with bounded backoff. Completion is the only acknowledgement.
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await signedFetch({
            context, method: 'PUT', path: `/v2/objects/uploads/${session.uploadId}/parts/${partNumber}`,
            scope: 'objects:write', appScopes: [meta.purpose], body: pending, bodySha256: partSha, timeoutMs: 30_000,
          });
          await readJson(response, partSchema);
          break;
        } catch (error) {
          if (error instanceof RodrigoResponseError && error.code === 'checksum_mismatch') await fail('checksum_mismatch');
          const retryable = error instanceof RodrigoUnavailableError
            || (error instanceof RodrigoResponseError && (error.status === 429 || error.status === 503));
          if (!retryable || attempt >= PART_ATTEMPTS - 1 || options.signal?.aborted) throw error;
          await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt * (0.5 + Math.random())));
        }
      }
    }
    bytesSent += pendingSize;
    options.onProgress?.({ bytesSent, partsSent: partNumber, partCount: session.partCount });
    partNumber += 1;
    pending = [];
    pendingSize = 0;
  };
  try {
    for await (const value of source) {
      if (options.signal?.aborted) throw new ObjectUploadError('aborted', 499);
      let chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      received += chunk.length;
      if (received > meta.size) await fail('checksum_mismatch');
      whole.update(chunk);
      while (chunk.length > 0) {
        const room = session.partBytes - pendingSize;
        const take = chunk.subarray(0, room);
        // Copy: the source may reuse its buffer after we yield.
        pending.push(Buffer.from(take));
        pendingSize += take.length;
        chunk = chunk.subarray(take.length);
        if (pendingSize === session.partBytes && received < meta.size) await flush();
      }
    }
    if (received !== meta.size || whole.digest('hex') !== meta.sha256) await fail('checksum_mismatch');
    await flush();
  } catch (error) {
    if (error instanceof ObjectUploadError || error instanceof RodrigoResponseError) throw error;
    // Unknown outcome (network, Rodrigo down): the session stays open for a resume.
    throw new RodrigoUnavailableError();
  }
  const response = await signedFetch({
    context, method: 'POST', path: `/v2/objects/uploads/${session.uploadId}/complete`, scope: 'objects:write',
    appScopes: [meta.purpose], body: '', timeoutMs: 300_000,
  });
  try {
    return await readJson(response, metaSchema);
  } catch (error) {
    if (error instanceof RodrigoResponseError && (error.code === 'integrity_failed' || error.code === 'checksum_mismatch')) {
      throw new ObjectUploadError(error.code);
    }
    throw error;
  }
}

export async function objectMeta(context: RodrigoContext, purpose: RodrigoObjectPurpose, objectId: string): Promise<RodrigoObjectMeta> {
  const response = await signedFetch({ context, method: 'GET', path: `/v2/objects/${encodeURIComponent(objectId)}/meta`, scope: 'objects:read', appScopes: [purpose] });
  return readJson(response, metaSchema);
}

/**
 * Opens a streamed read. The returned response body must be piped to the browser or
 * cancelled. A single `Range` header is forwarded.
 */
export async function openObject(context: RodrigoContext, purpose: RodrigoObjectPurpose, objectId: string, range?: string): Promise<Response> {
  const response = await signedFetch({
    context, method: 'GET', path: `/v2/objects/${encodeURIComponent(objectId)}`, scope: 'objects:read', appScopes: [purpose],
    headers: range && /^bytes=\d*-\d*$/.test(range) ? { Range: range } : {}, streamResponse: true, timeoutMs: 10_000,
  });
  if (!response.ok) await responseError(response);
  return response;
}

export async function deleteObject(context: RodrigoContext, purpose: RodrigoObjectPurpose, objectId: string): Promise<void> {
  const response = await signedFetch({ context, method: 'DELETE', path: `/v2/objects/${encodeURIComponent(objectId)}`, scope: 'objects:write', appScopes: [purpose] });
  if (!response.ok && response.status !== 404) await responseError(response);
  await response.body?.cancel();
}

/** Adapts a WHATWG stream (e.g. a request body) to an async iterable. */
export async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
