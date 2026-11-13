import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { RodrigoResponseError, RodrigoUnavailableError, type RodrigoContext } from './service-client';
import { signRodrigoRequest } from './sign-request';

/**
 * Shared transport for the alignment routes (objects, service tokens, change stream).
 * Same trust rules as service-client.ts: server-derived identity only, HTTPS outside
 * loopback development, no redirects, bounded error bodies, no automatic mutation retry.
 */
export interface RodrigoTarget { origin: URL; keyId: string; privateKeyPem: string }

let keyCache: { file: string; pem: string; at: number } | undefined;

export async function rodrigoTarget(): Promise<RodrigoTarget> {
  const raw = process.env.RODRIGO_BASE_URL;
  const keyFile = process.env.RODRIGO_PRIVATE_KEY_FILE;
  const keyId = process.env.RODRIGO_KEY_ID;
  if (!raw || !keyFile || !keyId) throw new RodrigoUnavailableError();
  let origin: URL;
  try { origin = new URL(raw); } catch { throw new RodrigoUnavailableError(); }
  const localHttp = process.env.NODE_ENV !== 'production' && origin.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if ((!localHttp && origin.protocol !== 'https:') || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
    throw new RodrigoUnavailableError();
  }
  // Re-read at most every 60 s so key rotation does not need a restart.
  if (!keyCache || keyCache.file !== keyFile || Date.now() - keyCache.at > 60_000) {
    try { keyCache = { file: keyFile, pem: await readFile(keyFile, 'utf8'), at: Date.now() }; } catch { throw new RodrigoUnavailableError(); }
  }
  return { origin, keyId, privateKeyPem: keyCache.pem };
}

const errorSchema = z.object({ error: z.object({ code: z.string().min(1).max(128), requestId: z.string().uuid() }) });

export interface SignedFetch {
  context: RodrigoContext; method: string; path: string; scope: string;
  appScopes?: string[]; actionScopes?: string[];
  body?: string | Uint8Array | Buffer[]; bodySha256?: string;
  headers?: Record<string, string>; timeoutMs?: number;
  /** The timeout covers only the response headers (downloads, SSE). */
  streamResponse?: boolean;
}

/** Signs exactly one request. Returns the raw response; callers own body consumption. */
export async function signedFetch(input: SignedFetch): Promise<Response> {
  if (!input.context.userId || !input.context.workspaceId) throw new RodrigoUnavailableError();
  const target = await rodrigoTarget();
  const parts = Array.isArray(input.body) ? input.body : undefined;
  const bytes: string | Uint8Array = parts ? new Uint8Array(0) : ((input.body as string | Uint8Array | undefined) ?? '');
  const token = signRodrigoRequest({
    ...input.context, scope: input.scope, method: input.method, path: input.path, body: bytes,
    keyId: target.keyId, privateKeyPem: target.privateKeyPem,
    ...(input.appScopes ? { appScopes: input.appScopes.map((app) => `app:${app}`) } : {}),
    ...(input.actionScopes ? { actionScopes: input.actionScopes } : {}),
    ...(input.bodySha256 ? { bodySha256: input.bodySha256 } : {}),
  });
  // Parts are streamed from the held chunks without another 8 MiB copy.
  const body = parts
    ? new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); } })
    : input.body === undefined ? undefined : input.body as BodyInit;
  // Streamed responses: the deadline covers the response headers only; the caller bounds
  // the body (and cancels it when the browser goes away).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 5000);
  try {
    const response = await fetch(new URL(input.path, target.origin), {
      method: input.method, body,
      headers: { Authorization: `Bearer ${token}`, ...(typeof input.body === 'string' ? { 'Content-Type': 'application/json' } : parts ? { 'Content-Type': 'application/octet-stream' } : {}), ...input.headers },
      signal: input.streamResponse ? controller.signal : AbortSignal.any([controller.signal, AbortSignal.timeout(input.timeoutMs ?? 5000)]),
      redirect: 'error', cache: 'no-store', ...(parts ? { duplex: 'half' } : {}),
    } as RequestInit);
    return response;
  } catch {
    throw new RodrigoUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

/** Reads a bounded JSON body; non-2xx becomes RodrigoResponseError with the machine code. */
export async function readJson<T>(response: Response, schema: z.ZodType<T>, limit = 65536): Promise<T> {
  const text = await boundedText(response, response.ok ? limit : 65536);
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new RodrigoUnavailableError(); }
  if (!response.ok) {
    const parsed = errorSchema.safeParse(data);
    if (!parsed.success) throw new RodrigoUnavailableError();
    throw new RodrigoResponseError(response.status, parsed.data.error.code, parsed.data.error.requestId);
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new RodrigoUnavailableError();
  return result.data;
}

/** Consumes an error body (bounded) into RodrigoResponseError. */
export async function responseError(response: Response): Promise<never> {
  return readJson(response, z.never());
}

async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new RodrigoUnavailableError();
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RodrigoUnavailableError) throw error;
    throw new RodrigoUnavailableError();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
}
