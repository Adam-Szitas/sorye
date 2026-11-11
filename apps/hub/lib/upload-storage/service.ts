import { createHash } from 'node:crypto';
import {
  ownStorageAllowed,
  type DatabaseConnectionPublic,
  type DriveConnectionPublic,
  type HubSession,
  type OwnStorageErrorCode,
  type OwnStorageResult,
  type OwnStorageSnapshot,
  type StorageSpace,
  type SubscriptionTierId,
  type UploadTarget,
} from '@sorye/types';
import { devInsecure } from './mode';
import { decryptBoundStorageSecret, encryptBoundStorageSecret, storageEncryptionReady } from '@/lib/storage-crypto';
import { DatabaseError, deleteDatabaseRow, getDatabaseRow, measureDatabase, putDatabaseRow, verifyDatabase } from './database';
import { DriveError, deleteDriveObject, driveObjectKey, getDriveObject, putDriveObject, verifyDrive } from './drive';
import {
  getSettings,
  liveFileCount,
  recentUploads,
  updateSettings,
  usage,
  type StorageSettings,
  type StoredDatabase,
  type StoredDrive,
} from './store';
import {
  InputError,
  keyHint,
  validateDatabaseInput,
  validateDriveInput,
  validateLimitGb,
  type DatabaseConfig,
  type DatabaseSecret,
  type DriveConfig,
  type DriveSecret,
} from './validate';

export class OwnStorageError extends Error {
  constructor(readonly code: OwnStorageErrorCode, readonly field?: string) {
    super(code);
    this.name = 'OwnStorageError';
  }
}

export { devInsecure };

const driveContext = (workspaceId: string) => `own-storage:drive:${workspaceId}`;
const databaseContext = (workspaceId: string) => `own-storage:database:${workspaceId}`;

function driveSecret(settings: StorageSettings): DriveSecret {
  if (!settings.driveSecretEncrypted) throw new OwnStorageError('target_not_ready');
  try {
    return JSON.parse(decryptBoundStorageSecret(settings.driveSecretEncrypted, driveContext(settings.workspaceId))) as DriveSecret;
  } catch {
    throw new OwnStorageError('encryption_unavailable');
  }
}

function databaseSecret(settings: StorageSettings): DatabaseSecret {
  if (!settings.databaseSecretEncrypted) throw new OwnStorageError('target_not_ready');
  try {
    return JSON.parse(decryptBoundStorageSecret(settings.databaseSecretEncrypted, databaseContext(settings.workspaceId))) as DatabaseSecret;
  } catch {
    throw new OwnStorageError('encryption_unavailable');
  }
}

function driveConfigOf(stored: StoredDrive): DriveConfig {
  const { provider, bucket, region, accountId, endpoint, pathStyle, prefix, limitBytes } = stored;
  return { provider, bucket, region, accountId, endpoint, pathStyle, prefix, limitBytes };
}

function databaseConfigOf(stored: StoredDatabase): DatabaseConfig {
  const { host, port, database, user, schema, tls, limitBytes } = stored;
  return { host, port, database, user, schema, tls, limitBytes };
}

async function space(workspaceId: string, target: UploadTarget, limitBytes: number): Promise<StorageSpace> {
  const used = await usage(workspaceId, target);
  return { usedBytes: used.usedBytes, limitBytes, freeBytes: Math.max(0, limitBytes - used.usedBytes), fileCount: used.fileCount };
}

async function drivePublic(settings: StorageSettings): Promise<DriveConnectionPublic | null> {
  const d = settings.drive;
  if (!d) return null;
  return {
    provider: d.provider, bucket: d.bucket, region: d.region, ...(d.accountId ? { accountId: d.accountId } : {}),
    ...(d.endpoint ? { endpoint: d.endpoint } : {}), pathStyle: d.pathStyle, prefix: d.prefix, accessKeyHint: d.accessKeyHint,
    status: d.status, lastErrorCode: d.lastErrorCode, verifiedAt: d.verifiedAt, updatedAt: d.updatedAt,
    space: await space(settings.workspaceId, 'drive', d.limitBytes),
  };
}

async function databasePublic(settings: StorageSettings): Promise<DatabaseConnectionPublic | null> {
  const d = settings.database;
  if (!d) return null;
  return {
    host: d.host, port: d.port, database: d.database, user: d.user, schema: d.schema, tls: d.tls, hasCustomCa: d.hasCustomCa,
    status: d.status, lastErrorCode: d.lastErrorCode, tableBytes: d.tableBytes, verifiedAt: d.verifiedAt, updatedAt: d.updatedAt,
    space: await space(settings.workspaceId, 'database', d.limitBytes),
  };
}

export async function getOwnStorageSnapshot(session: HubSession): Promise<OwnStorageSnapshot> {
  const workspaceId = session.workspace.id;
  const settings = await getSettings(workspaceId);
  const canManage = session.workspace.ownerId === session.user.id;
  return {
    eligible: ownStorageAllowed(session.workspace.subscriptionId),
    canManage,
    encryptionReady: storageEncryptionReady(),
    devInsecure: devInsecure(),
    target: settings?.target ?? 'sorye',
    drive: settings ? await drivePublic(settings) : null,
    database: settings ? await databasePublic(settings) : null,
    // Upload history is owner information: who uploaded what and when.
    recentUploads: canManage ? await recentUploads(workspaceId) : [],
  };
}

function assertManager(session: HubSession, needsEligibility = true): void {
  if (session.workspace.ownerId !== session.user.id) throw new OwnStorageError('not_owner');
  if (needsEligibility && !ownStorageAllowed(session.workspace.subscriptionId)) throw new OwnStorageError('not_eligible');
}

function assertEncryption(): void {
  if (!storageEncryptionReady()) throw new OwnStorageError('encryption_unavailable');
}

function sameDriveLocation(a: DriveConfig, b: DriveConfig): boolean {
  return a.provider === b.provider && a.bucket === b.bucket && a.prefix === b.prefix &&
    (a.endpoint ?? '') === (b.endpoint ?? '') && (a.accountId ?? '') === (b.accountId ?? '') && a.region === b.region;
}

function sameDatabaseLocation(a: DatabaseConfig, b: DatabaseConfig): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database && a.schema === b.schema;
}

/** Run an operation and turn any failure into a result code. Raw errors never reach the browser. */
export async function ownStorageResult(session: HubSession, action: () => Promise<void>): Promise<OwnStorageResult> {
  try {
    await action();
    return { ok: true, snapshot: await getOwnStorageSnapshot(session) };
  } catch (error) {
    if (error instanceof OwnStorageError) return { ok: false, code: error.code, ...(error.field ? { field: error.field } : {}) };
    if (error instanceof InputError) return { ok: false, code: 'invalid_input', field: error.field };
    if (error instanceof DriveError || error instanceof DatabaseError) return { ok: false, code: error.code };
    console.error('[own-storage] unexpected failure', error instanceof Error ? error.name : 'unknown');
    return { ok: false, code: 'unknown' };
  }
}

export async function connectDrive(session: HubSession, input: Record<string, unknown>): Promise<void> {
  assertManager(session);
  assertEncryption();
  const { config, secret } = validateDriveInput(input, devInsecure());
  await verifyDrive(config, secret, devInsecure());
  const workspaceId = session.workspace.id;
  const files = await liveFileCount(workspaceId, 'drive');
  const now = new Date().toISOString();
  await updateSettings(workspaceId, session.user.id, (current) => {
    if (current.drive && files > 0 && !sameDriveLocation(driveConfigOf(current.drive), config)) {
      // Files already stored would no longer be reachable at a different bucket or prefix.
      throw new OwnStorageError('in_use');
    }
    return {
      ...current,
      drive: { ...config, accessKeyHint: keyHint(secret.accessKeyId), status: 'connected', lastErrorCode: null, verifiedAt: now, updatedAt: now },
      driveSecretEncrypted: encryptBoundStorageSecret(JSON.stringify(secret), driveContext(workspaceId)),
    };
  });
}

export async function connectDatabase(session: HubSession, input: Record<string, unknown>): Promise<void> {
  assertManager(session);
  assertEncryption();
  const { config, secret } = validateDatabaseInput(input, devInsecure());
  const { tableBytes } = await verifyDatabase(config, secret, devInsecure());
  const workspaceId = session.workspace.id;
  const files = await liveFileCount(workspaceId, 'database');
  const now = new Date().toISOString();
  await updateSettings(workspaceId, session.user.id, (current) => {
    if (current.database && files > 0 && !sameDatabaseLocation(databaseConfigOf(current.database), config)) {
      throw new OwnStorageError('in_use');
    }
    return {
      ...current,
      database: { ...config, hasCustomCa: Boolean(secret.caPem), status: 'connected', lastErrorCode: null, tableBytes, verifiedAt: now, updatedAt: now },
      databaseSecretEncrypted: encryptBoundStorageSecret(JSON.stringify(secret), databaseContext(workspaceId)),
    };
  });
}

export async function setLimit(session: HubSession, target: 'drive' | 'database', limitGb: unknown): Promise<void> {
  assertManager(session);
  const limitBytes = validateLimitGb(limitGb);
  await updateSettings(session.workspace.id, session.user.id, (current) => {
    const entry = current[target];
    if (!entry) throw new OwnStorageError('target_not_ready');
    return { ...current, [target]: { ...entry, limitBytes, updatedAt: new Date().toISOString() } };
  });
}

/** Re-test a saved connection with its stored credentials and record the outcome. */
export async function checkConnection(session: HubSession, target: 'drive' | 'database'): Promise<void> {
  // Members without the plan can still check where their existing files are.
  assertManager(session, false);
  const workspaceId = session.workspace.id;
  const settings = await getSettings(workspaceId);
  if (!settings?.[target]) throw new OwnStorageError('target_not_ready');
  let code: OwnStorageErrorCode | null = null;
  let tableBytes: number | null | undefined;
  try {
    if (target === 'drive') await verifyDrive(driveConfigOf(settings.drive!), driveSecret(settings), devInsecure());
    else tableBytes = (await verifyDatabase(databaseConfigOf(settings.database!), databaseSecret(settings), devInsecure())).tableBytes;
  } catch (error) {
    code = error instanceof DriveError || error instanceof DatabaseError || error instanceof OwnStorageError ? error.code : 'unknown';
  }
  await recordStatus(workspaceId, session.user.id, target, code, tableBytes);
  if (code) throw new OwnStorageError(code);
}

async function recordStatus(workspaceId: string, userId: string, target: 'drive' | 'database', code: OwnStorageErrorCode | null, tableBytes?: number | null) {
  await updateSettings(workspaceId, userId, (current) => {
    const entry = current[target];
    if (!entry) return current;
    const now = new Date().toISOString();
    const next = { ...entry, status: code ? 'error' as const : 'connected' as const, lastErrorCode: code, ...(code ? {} : { verifiedAt: now }) };
    if (target === 'database' && tableBytes !== undefined) (next as StoredDatabase).tableBytes = tableBytes;
    return { ...current, [target]: next };
  }).catch(() => undefined);
}

export async function disconnect(session: HubSession, target: 'drive' | 'database'): Promise<void> {
  assertManager(session, false);
  const workspaceId = session.workspace.id;
  const files = await liveFileCount(workspaceId, target);
  await updateSettings(workspaceId, session.user.id, (current) => {
    if (current.target === target) throw new OwnStorageError('in_use');
    // Files stored there would become unreadable; they must be deleted or the connection kept.
    if (files > 0) throw new OwnStorageError('in_use');
    return target === 'drive'
      ? { ...current, drive: null, driveSecretEncrypted: null }
      : { ...current, database: null, databaseSecretEncrypted: null };
  });
}

export async function setTarget(session: HubSession, target: UploadTarget): Promise<void> {
  if (target === 'sorye') {
    assertManager(session, false);
  } else {
    assertManager(session);
    // Re-test right before switching so uploads never start against a broken connection.
    await checkConnection(session, target);
  }
  await updateSettings(session.workspace.id, session.user.id, (current) => {
    if (target !== 'sorye' && !current[target]) throw new OwnStorageError('target_not_ready');
    return { ...current, target };
  });
}

// ── Upload routing used by lib/files.ts ─────────────────────────────────────

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface UploadDestination {
  target: UploadTarget;
  /** Limit to enforce, or null for Sorye's storage (its own caps apply). */
  limitBytes: number | null;
  /** Store the bytes; returns where they are. */
  put(fileId: string, bytes: Buffer, mime: string, sha256: string, displayName: string): Promise<string>;
}

/**
 * Where the next upload of this workspace goes. Fails closed: if the owner
 * chose their own storage and it cannot be used, the upload is refused and
 * nothing is written to Sorye's storage.
 */
export async function uploadDestination(workspaceId: string, tier: SubscriptionTierId): Promise<UploadDestination | null> {
  const settings = await getSettings(workspaceId);
  if (!settings || settings.target === 'sorye') return null;
  if (!ownStorageAllowed(tier)) throw new OwnStorageError('not_eligible');
  const allowPrivate = devInsecure();
  if (settings.target === 'drive') {
    if (!settings.drive) throw new OwnStorageError('target_not_ready');
    const config = driveConfigOf(settings.drive);
    const secret = driveSecret(settings);
    return {
      target: 'drive',
      limitBytes: config.limitBytes,
      async put(fileId, bytes, mime, sha256) {
        const key = driveObjectKey(config, workspaceId, fileId);
        await putDriveObject(config, secret, allowPrivate, key, bytes, mime, sha256);
        return key;
      },
    };
  }
  if (!settings.database) throw new OwnStorageError('target_not_ready');
  const config = databaseConfigOf(settings.database);
  const secret = databaseSecret(settings);
  return {
    target: 'database',
    limitBytes: config.limitBytes,
    async put(fileId, bytes, mime, sha256, displayName) {
      await putDatabaseRow(config, secret, allowPrivate, { id: fileId, workspaceId, fileName: displayName, mime, sha256, bytes });
      return `${config.schema}.files/${fileId}`;
    },
  };
}

/** Record that an upload to customer storage failed, so the owner sees it in the connection status. */
export async function noteStorageFailure(workspaceId: string, target: 'drive' | 'database', code: OwnStorageErrorCode): Promise<void> {
  const settings = await getSettings(workspaceId);
  if (settings?.[target]) await recordStatus(workspaceId, settings.updatedBy, target, code);
}

/**
 * Read a file stored on customer storage and prove it is the file Sorye
 * stored: same size and same SHA-256. Bytes changed on the customer's side
 * are refused instead of being served under Sorye's content type.
 */
export async function readExternalFile(workspaceId: string, file: { id: string; storedIn?: string; size: number; sha256?: string }): Promise<Buffer> {
  const settings = await getSettings(workspaceId);
  const allowPrivate = devInsecure();
  let bytes: Buffer;
  if (file.storedIn === 'drive') {
    if (!settings?.drive) throw new OwnStorageError('target_not_ready');
    const config = driveConfigOf(settings.drive);
    bytes = await getDriveObject(config, driveSecret(settings), allowPrivate, driveObjectKey(config, workspaceId, file.id));
  } else if (file.storedIn === 'database') {
    if (!settings?.database) throw new OwnStorageError('target_not_ready');
    bytes = await getDatabaseRow(databaseConfigOf(settings.database), databaseSecret(settings), allowPrivate, file.id, workspaceId);
  } else {
    throw new OwnStorageError('target_not_ready');
  }
  if (bytes.length !== file.size || !file.sha256 || sha256Hex(bytes) !== file.sha256) throw new OwnStorageError('integrity_failed');
  return bytes;
}

export async function deleteExternalFile(workspaceId: string, file: { id: string; storedIn?: string }): Promise<void> {
  const settings = await getSettings(workspaceId);
  const allowPrivate = devInsecure();
  if (file.storedIn === 'drive' && settings?.drive) {
    const config = driveConfigOf(settings.drive);
    await deleteDriveObject(config, driveSecret(settings), allowPrivate, driveObjectKey(config, workspaceId, file.id));
  } else if (file.storedIn === 'database' && settings?.database) {
    await deleteDatabaseRow(databaseConfigOf(settings.database), databaseSecret(settings), allowPrivate, file.id, workspaceId);
  } else {
    throw new OwnStorageError('target_not_ready');
  }
}

/** Refresh the measured table size of a connected database (best effort). */
export async function refreshDatabaseSize(session: HubSession): Promise<void> {
  const settings = await getSettings(session.workspace.id);
  if (!settings?.database) return;
  const bytes = await measureDatabase(databaseConfigOf(settings.database), databaseSecret(settings), devInsecure()).catch(() => null);
  if (bytes !== null) await recordStatus(session.workspace.id, session.user.id, 'database', null, bytes);
}
