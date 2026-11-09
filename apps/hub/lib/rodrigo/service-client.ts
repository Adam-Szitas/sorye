import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { RodrigoCapabilities, RodrigoDocumentKind, RodrigoDocumentWrite, RodrigoDocumentDelete, RodrigoSnapshot, RodrigoTopology, RodrigoActionBatch, RodrigoActionBatchResult, RodrigoActionAppId, RodrigoActionResourceType, RodrigoResourceSnapshot, RodrigoCollectionPage, RodrigoMessengerMessagePage } from '@sorye/types';
import { signRodrigoRequest } from './sign-request';
import { actionBatchSchema as validatedActionBatchSchema } from './action-validation';

const status = z.enum(['not_implemented', 'not_configured', 'ready']);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const resourceTypes: Record<RodrigoActionAppId, readonly RodrigoActionResourceType[]> = {
  tasks: ['task', 'taskBoard'], notes: ['note'], calendar: ['event'], workspace: ['settings'],
  messenger: ['channel', 'message', 'reaction'], files: ['fileMetadata'], canvas: ['board'],
  mail: ['account', 'draft'], relay: ['config'], site: ['page'], storefront: ['product', 'order'],
  ocr: ['analysis', 'pattern'], studio: ['project'], notifications: ['notification'],
  events: ['event'], embed: ['widget'], protocolio: ['artifact'],
};
function assertResourceFamily(appId: RodrigoActionAppId, resourceType: RodrigoActionResourceType) {
  if (!resourceTypes[appId]?.includes(resourceType)) throw new Error('Invalid Rodrigo app/resource family.');
}
const capabilitiesSchema = z.object({
  contractVersion: z.literal('1'), contractVersions: z.array(z.enum(['1', '2'])), service: z.literal('rodrigo'), dataReady: z.boolean(),
  actions: z.object({ version: z.literal('2'), provider: z.enum(['not_configured', 'ready']), maxBatchActions: z.literal(100), maxBodyBytes: z.literal(262144), maxCollectionPageSize: z.literal(100), families: z.array(z.string()) }),
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
  schema: z.ZodType<T>, method = 'GET', input?: unknown, limit = 65536,
  actionScopes?: { apps: string[]; actions: string[] }): Promise<T> {
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
    const token = signRodrigoRequest({ ...context, scope, method, path, body, keyId, privateKeyPem,
      ...(actionScopes ? { appScopes: actionScopes.apps.map((app) => `app:${app}`), actionScopes: actionScopes.actions.map((action) => action.startsWith('read:') ? action : `action:${action}`) } : {}) });
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

const actionResultSchema = z.object({
  actionId: z.string().uuid(), status: z.enum(['committed', 'duplicate', 'conflict', 'rejected']),
  commitId: z.string().uuid().optional(), revision: z.number().int().positive().optional(),
  result: z.record(z.unknown()).optional(), error: z.object({ code: z.string(), message: z.string() }).optional(),
}).strict().superRefine((value, ctx) => {
  const durable = value.status === 'committed' || value.status === 'duplicate';
  if (durable && (!value.commitId || value.revision === undefined || value.error)) {
    ctx.addIssue({ code: 'custom', message: 'durable acknowledgements require commitId and revision only' });
  }
  if (!durable && !value.error) ctx.addIssue({ code: 'custom', message: 'non-durable outcomes require machine-readable error details' });
});
const actionBatchResponseSchema = z.object({ contractVersion: z.literal('2'), results: z.array(actionResultSchema).max(100) }).strict();
export function submitRodrigoActionBatch(context: RodrigoContext, batch: RodrigoActionBatch): Promise<RodrigoActionBatchResult> {
  const validated = validatedActionBatchSchema.superRefine((value, ctx) => {
    const ids = new Set<string>();
    value.actions.forEach((action, index) => {
      if (ids.has(action.actionId)) ctx.addIssue({ code: 'custom', path: ['actions', index, 'actionId'], message: 'actionId must be unique within a batch' });
      ids.add(action.actionId);
    });
  }).parse(batch);
  const apps = [...new Set(validated.actions.map((a) => a.appId))];
  const scopes = [...new Set(validated.actions.map((a) => `${a.appId}.${a.resourceType}.${a.operation}`))];
  return request(context, '/v2/actions/batch', 'actions:write', actionBatchResponseSchema, 'POST', validated, 262144, { apps, actions: scopes })
    .then((result) => {
      const expectedIds = new Set(validated.actions.map((item) => item.actionId));
      const resultIds = new Set(result.results.map((item) => item.actionId));
      if (result.results.length !== validated.actions.length || resultIds.size !== result.results.length
        || resultIds.size !== expectedIds.size || [...resultIds].some((id) => !expectedIds.has(id))) {
        throw new RodrigoUnavailableError();
      }
      return result;
    });
}
export function getRodrigoResource(context: RodrigoContext, appId: RodrigoActionAppId, resourceType: RodrigoActionResourceType, resourceId: string): Promise<RodrigoResourceSnapshot> {
  assertResourceFamily(appId, resourceType);
  if (!resourceId || resourceId.length > 160) throw new Error('Invalid Rodrigo resource identity.');
  const schema = z.object({ revision, resource: z.record(z.unknown()).nullable(), createdByUserId: z.string().min(1).max(160).optional() }).strict();
  return request(context, `/v2/resources/${appId}/${resourceType}/${encodeURIComponent(resourceId)}`, 'actions:read', schema, 'GET', undefined, 2097152,
    { apps: [appId], actions: [`read:${appId}.${resourceType}`] });
}

const collectionPageSchema = z.object({ items: z.array(z.object({ resourceId: z.string().min(1).max(160), revision: revision.positive(), createdByUserId: z.string().min(1).max(160).optional(), resource: z.record(z.unknown()) }).strict()).max(100), nextCursor: z.string().max(512).nullable() }).strict();
export function listRodrigoResources(context: RodrigoContext, appId: RodrigoActionAppId, resourceType: RodrigoActionResourceType, limit = 100, cursor?: string): Promise<RodrigoCollectionPage> {
  assertResourceFamily(appId, resourceType);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== undefined && (!cursor || cursor.length > 321))) throw new Error('Invalid Rodrigo collection page request.');
  const path = `/v2/collections/${appId}/${resourceType}/${limit}/${encodeURIComponent(cursor ?? 'first')}`;
  return request(context, path, 'actions:read', collectionPageSchema, 'GET', undefined, 2097152, { apps: [appId], actions: [`read:${appId}.${resourceType}`] });
}

const messengerPageSchema = z.object({
  messages: z.array(z.object({ resourceId: z.string().min(1).max(160), revision: revision.positive(), createdByUserId: z.string().min(1).max(160).optional(), resource: z.record(z.unknown()) }).strict()).max(50),
  hasMore: z.boolean(), nextCursor: z.string().max(321).nullable(),
}).strict();
const publishedSiteSchema = z.object({
  slug: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  blocks: z.array(z.object({ id: z.string().min(1).max(160), kind: z.enum(['hero', 'about', 'links', 'shop', 'contact']), content: z.record(z.unknown()) }).strict()).max(100),
  products: z.array(z.object({
    id: z.string().min(1).max(160), title: z.string().min(1).max(120), summary: z.string().max(240),
    priceCents: z.number().int().min(0).max(10_000_000), category: z.string().max(40), accent: z.string().max(32),
  }).strict()).max(100),
}).strict();
export type PublishedSiteResource = z.infer<typeof publishedSiteSchema>;
/** Matches Rodrigo's reserved public-site assertion. Not a browser-selected workspace. */
export const PUBLIC_SITE_CONTEXT: RodrigoContext = { userId: 'rodrigo-public-reader', workspaceId: 'rodrigo-public-site' };
export async function readPublishedSite(slug: string): Promise<PublishedSiteResource | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) throw new Error('Invalid public site slug.');
  try {
    return await request(PUBLIC_SITE_CONTEXT, `/v2/public/sites/${encodeURIComponent(slug)}`, 'actions:read', publishedSiteSchema, 'GET', undefined, 2097152, {
      apps: ['site', 'storefront'], actions: ['read:site.page', 'read:storefront.product'],
    });
  } catch (error) {
    if (error instanceof RodrigoResponseError && error.status === 404) return null;
    throw error;
  }
}
export async function listRodrigoResourcesBounded(context: RodrigoContext, appId: RodrigoActionAppId, resourceType: RodrigoActionResourceType, pages = 5) {
  const items: RodrigoCollectionPage['items'] = [];
  let cursor: string | undefined;
  const limit = Math.min(5, Math.max(1, pages));
  for (let page = 0; page < limit; page += 1) {
    const listed = await listRodrigoResources(context, appId, resourceType, 100, cursor);
    items.push(...listed.items);
    if (!listed.nextCursor) break;
    cursor = listed.nextCursor;
  }
  return items;
}

export function listRodrigoMessengerMessages(context: RodrigoContext, channelId: string, input: { direction: 'older' | 'newer'; limit?: number; cursor?: string } = { direction: 'older' }): Promise<RodrigoMessengerMessagePage> {
  const limit = input.limit ?? 30;
  const cursor = input.cursor ?? 'latest';
  if (!channelId || channelId.length > 160 || channelId.includes('|') || !Number.isInteger(limit) || limit < 1 || limit > 50 || !cursor || cursor.length > 321 || (input.direction === 'newer' && cursor === 'latest')) throw new Error('Invalid Messenger timeline request.');
  const path = `/v2/messenger/channels/${encodeURIComponent(channelId)}/messages/${input.direction}/${limit}/${encodeURIComponent(cursor)}`;
  return request(context, path, 'actions:read', messengerPageSchema, 'GET', undefined, 2097152, { apps: ['messenger'], actions: ['read:messenger.channel', 'read:messenger.message'] });
}

const kindSchema = z.enum(['tasks', 'notes', 'calendar']);
const provider = z.enum(['postgresql', 'mysql', 'mongodb']);
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
