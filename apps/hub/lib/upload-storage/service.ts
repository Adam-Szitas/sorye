import {
  ownStorageAllowed,
  type HubSession,
  type OwnStorageErrorCode,
  type OwnStorageResult,
  type OwnStorageSnapshot,
  type UploadRecord,
  type UploadTarget,
} from '@sorye/types';
import { z } from 'zod';
import { driveLedger } from '@/lib/rodrigo/drive-client';
import { RodrigoResponseError, RodrigoUnavailableError, type RodrigoContext } from '@/lib/rodrigo/service-client';
import { readJson, signedFetch } from '@/lib/rodrigo/transport';
import { devInsecure } from './mode';
import { InputError, validateDatabaseInput, validateDriveInput, validateLimitGb } from './validate';

/**
 * "Your storage" (alignment slice 2). Rodrigo owns the workspace storage target, the
 * sealed credentials (Hub holds no key), connection probes and the upload ledger. Hub
 * keeps the owner/plan checks for a fast refusal and strict input validation at the
 * edge; Rodrigo repeats both as the authority.
 */
export class OwnStorageError extends Error {
  constructor(readonly code: OwnStorageErrorCode, readonly field?: string) {
    super(code);
    this.name = 'OwnStorageError';
  }
}

export { devInsecure };

const KNOWN: readonly string[] = ['invalid_input', 'host_not_allowed', 'host_unresolved', 'unreachable', 'tls_failed', 'auth_failed', 'not_found',
  'permission_denied', 'timeout', 'encryption_unavailable', 'not_eligible', 'not_owner', 'quota_exceeded', 'storage_unavailable',
  'integrity_failed', 'target_not_ready', 'in_use', 'rate_limited'];
const space = z.object({ usedBytes: z.number(), limitBytes: z.number(), freeBytes: z.number(), fileCount: z.number() });
const snapshotSchema = z.object({
  contractVersion: z.literal('2'), target: z.enum(['sorye', 'drive', 'database']),
  drive: z.object({
    provider: z.enum(['aws-s3', 'cloudflare-r2', 's3-compatible']), bucket: z.string(), region: z.string(), accountId: z.string().optional(),
    endpoint: z.string().optional(), pathStyle: z.boolean(), prefix: z.string(), accessKeyHint: z.string(), status: z.enum(['connected', 'error']),
    lastErrorCode: z.string().nullable(), verifiedAt: z.string(), updatedAt: z.string(), space,
  }).nullable(),
  database: z.object({
    host: z.string(), port: z.number(), database: z.string(), user: z.string(), schema: z.string(), tls: z.enum(['verify', 'encrypt', 'disable']),
    hasCustomCa: z.boolean(), status: z.enum(['connected', 'error']), lastErrorCode: z.string().nullable(), tableBytes: z.number().nullable(),
    verifiedAt: z.string(), updatedAt: z.string(), space,
  }).nullable(),
  encryptionReady: z.boolean(), devInsecure: z.boolean(),
});
type Wire = z.infer<typeof snapshotSchema>;

const ctx = (session: HubSession): RodrigoContext => ({ userId: session.user.id, workspaceId: session.workspace.id });
const SCOPES = ['relay', 'files'];

async function call(session: HubSession, method: string, path: string, body?: unknown, timeoutMs = 5000): Promise<Wire> {
  try {
    const response = await signedFetch({
      context: ctx(session), method, path, scope: method === 'GET' ? 'storage:read' : 'storage:write', appScopes: SCOPES,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), timeoutMs,
    });
    if (!response.ok && response.status < 500) {
      // Field-level validation errors carry the field name.
      const text = await response.text();
      const parsed = (() => { try { return JSON.parse(text) as { error?: { code?: string; field?: string } }; } catch { return null; } })();
      const code = parsed?.error?.code ?? 'unknown';
      throw new OwnStorageError((KNOWN.includes(code) ? code : 'unknown') as OwnStorageErrorCode, parsed?.error?.field);
    }
    return await readJson(response, snapshotSchema, 262144);
  } catch (error) {
    if (error instanceof OwnStorageError) throw error;
    if (error instanceof RodrigoResponseError) throw new OwnStorageError((KNOWN.includes(error.code) ? error.code : 'storage_unavailable') as OwnStorageErrorCode);
    if (error instanceof RodrigoUnavailableError) throw new OwnStorageError('storage_unavailable');
    throw error;
  }
}

function toLedger(rows: Awaited<ReturnType<typeof driveLedger>>, workspaceId: string): UploadRecord[] {
  const status = (s: string): UploadRecord['status'] => (s === 'ready' ? 'stored' : s === 'uploading' ? 'pending' : s === 'deleted' ? 'deleted' : 'failed');
  return rows.map((row) => ({
    id: row.id, workspaceId, fileId: row.status === 'failed' && !row.sha256 ? null : row.id, userId: row.createdByUserId,
    target: row.storedIn, location: row.status === 'ready' ? `${row.storedIn}:${row.id}` : null, displayName: row.displayName,
    mime: row.mime, size: row.size, sha256: row.sha256 ?? null, sourceAppId: row.sourceAppId, status: status(row.status),
    errorCode: (row.errorCode ?? null) as UploadRecord['errorCode'], createdAt: row.createdAt, completedAt: row.completedAt ?? null,
  }));
}

export async function getOwnStorageSnapshot(session: HubSession): Promise<OwnStorageSnapshot> {
  const canManage = session.workspace.ownerId === session.user.id;
  const [wire, ledger] = await Promise.all([
    call(session, 'GET', '/v2/storage/settings'),
    // Upload history is owner information: who uploaded what and when.
    canManage ? driveLedger(ctx(session), 25).catch(() => []) : Promise.resolve([]),
  ]);
  return {
    eligible: ownStorageAllowed(session.workspace.subscriptionId), canManage,
    encryptionReady: wire.encryptionReady, devInsecure: wire.devInsecure, target: wire.target,
    drive: wire.drive as OwnStorageSnapshot['drive'], database: wire.database as OwnStorageSnapshot['database'],
    recentUploads: toLedger(ledger, session.workspace.id),
  };
}

function assertManager(session: HubSession, needsEligibility = true): void {
  if (session.workspace.ownerId !== session.user.id) throw new OwnStorageError('not_owner');
  if (needsEligibility && !ownStorageAllowed(session.workspace.subscriptionId)) throw new OwnStorageError('not_eligible');
}

/** Run an operation and turn any failure into a result code. Raw errors never reach the browser. */
export async function ownStorageResult(session: HubSession, action: () => Promise<void>): Promise<OwnStorageResult> {
  try {
    await action();
    return { ok: true, snapshot: await getOwnStorageSnapshot(session) };
  } catch (error) {
    if (error instanceof OwnStorageError) return { ok: false, code: error.code, ...(error.field ? { field: error.field } : {}) };
    if (error instanceof InputError) return { ok: false, code: 'invalid_input', field: error.field };
    console.error('[own-storage] unexpected failure', error instanceof Error ? error.name : 'unknown');
    return { ok: false, code: 'unknown' };
  }
}

export async function connectDrive(session: HubSession, input: Record<string, unknown>): Promise<void> {
  assertManager(session);
  const { config, secret } = validateDriveInput(input, devInsecure());
  await call(session, 'PUT', '/v2/storage/drive', {
    config: { provider: config.provider, bucket: config.bucket, region: config.region, ...(config.accountId ? { accountId: config.accountId } : {}),
      ...(config.endpoint ? { endpoint: config.endpoint } : {}), pathStyle: config.pathStyle, prefix: config.prefix, limitBytes: config.limitBytes },
    secret: { accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey },
  }, 30_000);
}

export async function connectDatabase(session: HubSession, input: Record<string, unknown>): Promise<void> {
  assertManager(session);
  const { config, secret } = validateDatabaseInput(input, devInsecure());
  await call(session, 'PUT', '/v2/storage/database', {
    config: { host: config.host, port: config.port, database: config.database, user: config.user, schema: config.schema, tls: config.tls, limitBytes: config.limitBytes },
    secret: { password: secret.password, ...(secret.caPem ? { caPem: secret.caPem } : {}) },
  }, 30_000);
}

export async function setLimit(session: HubSession, target: 'drive' | 'database', limitGb: unknown): Promise<void> {
  assertManager(session);
  await call(session, 'PUT', `/v2/storage/${target}/limit`, { limitBytes: validateLimitGb(limitGb) });
}

/** Re-test a saved connection with its stored credentials; Rodrigo records the outcome. */
export async function checkConnection(session: HubSession, target: 'drive' | 'database'): Promise<void> {
  // Members without the plan can still check where their existing files are.
  assertManager(session, false);
  const wire = await call(session, 'POST', `/v2/storage/${target}/check`, undefined, 30_000);
  const entry = wire[target];
  if (entry?.status === 'error') throw new OwnStorageError((entry.lastErrorCode ?? 'unknown') as OwnStorageErrorCode);
}

export async function disconnect(session: HubSession, target: 'drive' | 'database'): Promise<void> {
  assertManager(session, false);
  await call(session, 'DELETE', `/v2/storage/${target}/connection`);
}

export async function setTarget(session: HubSession, target: UploadTarget): Promise<void> {
  if (target === 'sorye') {
    assertManager(session, false);
  } else {
    assertManager(session);
    // Re-test right before switching so uploads never start against a broken connection.
    await checkConnection(session, target);
  }
  await call(session, 'PUT', '/v2/storage/target', { target });
}

/** The measured table size is part of the database check. */
export async function refreshDatabaseSize(session: HubSession): Promise<void> {
  await checkConnection(session, 'database').catch(() => undefined);
}
