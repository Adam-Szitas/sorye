import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { RodrigoCapabilities, RodrigoDocumentKind, RodrigoDocumentWrite, RodrigoDocumentDelete, RodrigoSnapshot, RodrigoTopology } from '@sorye/types';
import { signRodrigoRequest } from './sign-request';

const status = z.enum(['not_implemented', 'not_configured', 'ready']);
const capabilitiesSchema = z.object({
  contractVersion: z.literal('1'), service: z.literal('rodrigo'), dataReady: z.boolean(),
  operations: z.array(z.string().max(64)).max(100),
  adapters: z.object({ postgresql: status, mongodb: status, redis: status, s3: status }),
});
export class RodrigoUnavailableError extends Error {
  constructor() { super('Rodrigo is unavailable or its contract is incompatible.'); }
}

/** Internal Node client; Hub routes import the server-only client.ts entry point. */
export interface RodrigoContext { userId: string; workspaceId: string }
export class RodrigoResponseError extends Error {
  constructor(readonly status: number, readonly code: string, readonly requestId: string) {
    super(`Rodrigo request failed (${status}, ${code}).`);
  }
}
const errorSchema = z.object({ error: z.object({ code: z.string().min(1).max(128), requestId: z.string().uuid() }) });

async function request<T>(context: RodrigoContext, path: string, scope: string,
  schema: z.ZodType<T>, method = 'GET', input?: unknown, limit = 65536): Promise<T> {
  const raw = process.env.RODRIGO_BASE_URL;
  const keyFile = process.env.RODRIGO_PRIVATE_KEY_FILE;
  const keyId = process.env.RODRIGO_KEY_ID;
  if (!raw || !keyFile || !keyId || !context.userId || !context.workspaceId) throw new RodrigoUnavailableError();
  try {
    const origin = new URL(raw);
    const localHttp = process.env.NODE_ENV !== 'production' && origin.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
    if ((!localHttp && origin.protocol !== 'https:') || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
      throw new RodrigoUnavailableError();
    }
    const privateKeyPem = await readFile(keyFile, 'utf8');
    const body = input === undefined ? '' : JSON.stringify(input);
    if (Buffer.byteLength(body) > 262144) throw new RodrigoUnavailableError();
    const token = signRodrigoRequest({ ...context, scope, method, path, body, keyId, privateKeyPem });
    // Never retry mutations: lost responses can still mean committed writes.
    const response = await fetch(new URL(path, origin), {
      method, ...(input === undefined ? {} : { body }),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000), redirect: 'error', cache: 'no-store',
    });
    if (!response.body) throw new RodrigoUnavailableError();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > (response.ok ? limit : 65536)) throw new RodrigoUnavailableError();
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok) {
      const { error } = errorSchema.parse(data);
      throw new RodrigoResponseError(response.status, error.code, error.requestId);
    }
    return schema.parse(data);
  } catch (error) {
    if (error instanceof RodrigoResponseError) throw error;
    throw new RodrigoUnavailableError();
  }
}

const kindSchema = z.enum(['tasks', 'notes', 'calendar']);
const provider = z.enum(['postgresql', 'mysql', 'mongodb']);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const expectedRevision = revision.max(Number.MAX_SAFE_INTEGER - 1);
const documentSchema = z.object({ revision: revision.min(1), payload: z.record(z.unknown()) });
const topologySchema = z.object({
  contractVersion: z.literal('1'), documentOwners: z.record(kindSchema, provider),
  documentProviders: z.array(provider).max(3), storage: z.array(z.string()).max(8),
  cacheReady: z.boolean(), events: z.object({
    delivery: z.literal('at-least-once-within-retention'),
    retainedRevisions: z.literal(1000), maxSubscribersPerReplica: z.literal(32),
  }),
});
const snapshotSchema = z.object({ revision, document: documentSchema.nullable() })
  .refine((value) => value.document === null || value.document.revision === value.revision);

export function getRodrigoCapabilities(context: RodrigoContext): Promise<RodrigoCapabilities> {
  return request(context, '/v1/capabilities', 'capabilities:read', capabilitiesSchema);
}
export function getRodrigoTopology(context: RodrigoContext): Promise<RodrigoTopology> {
  return request(context, '/v1/topology', 'capabilities:read', topologySchema);
}
export function getRodrigoSnapshot(context: RodrigoContext, kind: RodrigoDocumentKind): Promise<RodrigoSnapshot> {
  return request(context, `/v1/snapshots/${kindSchema.parse(kind)}`, 'documents:read', snapshotSchema, 'GET', undefined, 2097152);
}
export async function putRodrigoDocument(context: RodrigoContext, kind: RodrigoDocumentKind, input: RodrigoDocumentWrite) {
  const body = z.object({ expectedRevision, payload: z.record(z.unknown()) }).strict().parse(input);
  const result = await request(context, `/v1/documents/${kindSchema.parse(kind)}`, 'documents:write',
    z.object({ document: documentSchema }), 'PUT', body, 2097152);
  return result.document;
}
export function deleteRodrigoDocument(context: RodrigoContext, kind: RodrigoDocumentKind, input: RodrigoDocumentDelete) {
  const body = z.object({ expectedRevision: expectedRevision.min(1) }).strict().parse(input);
  return request(context, `/v1/documents/${kindSchema.parse(kind)}`, 'documents:delete',
    z.object({ revision, deleted: z.literal(true) }), 'DELETE', body);
}
