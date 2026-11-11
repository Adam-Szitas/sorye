import { and, desc, eq, inArray, gt, or, sql as dsql } from 'drizzle-orm';
import { getDb } from '@sorye/db';
import * as schema from '@sorye/db/schema';
import type { OwnStorageErrorCode, UploadRecord, UploadRecordStatus, UploadTarget } from '@sorye/types';
import { getStoreDriver } from '@/lib/env';
import { jsonDataFile } from '@/lib/store/json-file';
import type { DatabaseConfig, DriveConfig } from './validate';

/**
 * Own-storage settings and the upload ledger, in the Hub's own store
 * (Postgres in production, JSON locally). Secrets are stored only as
 * workspace-bound ciphertexts.
 */

export interface StoredDrive extends DriveConfig {
  accessKeyHint: string;
  status: 'connected' | 'error';
  lastErrorCode: OwnStorageErrorCode | null;
  verifiedAt: string;
  updatedAt: string;
}

export interface StoredDatabase extends DatabaseConfig {
  hasCustomCa: boolean;
  status: 'connected' | 'error';
  lastErrorCode: OwnStorageErrorCode | null;
  tableBytes: number | null;
  verifiedAt: string;
  updatedAt: string;
}

export interface StorageSettings {
  workspaceId: string;
  target: UploadTarget;
  drive: StoredDrive | null;
  driveSecretEncrypted: string | null;
  database: StoredDatabase | null;
  databaseSecretEncrypted: string | null;
  updatedBy: string;
  updatedAt: string;
}

export class QuotaExceededError extends Error {
  constructor() {
    super('quota_exceeded');
    this.name = 'QuotaExceededError';
  }
}

/** A reservation older than this no longer counts toward used space (the upload died). */
const PENDING_TTL_MS = 60 * 60 * 1000;
/** JSON store keeps at most this many ledger rows per workspace; live rows are never dropped. */
const JSON_LEDGER_CAP = 5_000;
const LIVE: readonly UploadRecordStatus[] = ['pending', 'stored'];

type JsonData = { settings: Record<string, StorageSettings>; ledger: Record<string, UploadRecord[]> };
const jsonFile = jsonDataFile<JsonData>('own-storage.json', () => ({ settings: {}, ledger: {} }));

function usePostgres(): boolean {
  return getStoreDriver() === 'postgres';
}

function counts(row: UploadRecord, now: number): boolean {
  if (row.status === 'stored') return true;
  return row.status === 'pending' && now - Date.parse(row.createdAt) < PENDING_TTL_MS;
}

// ── Settings ────────────────────────────────────────────────────────────────

function rowToSettings(row: typeof schema.workspaceUploadStorage.$inferSelect): StorageSettings {
  return {
    workspaceId: row.workspaceId,
    target: (row.target as UploadTarget) ?? 'sorye',
    drive: (row.drive as StoredDrive | null) ?? null,
    driveSecretEncrypted: row.driveSecretEncrypted,
    database: (row.database as StoredDatabase | null) ?? null,
    databaseSecretEncrypted: row.databaseSecretEncrypted,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function emptySettings(workspaceId: string, userId: string): StorageSettings {
  return { workspaceId, target: 'sorye', drive: null, driveSecretEncrypted: null, database: null, databaseSecretEncrypted: null, updatedBy: userId, updatedAt: new Date().toISOString() };
}

export async function getSettings(workspaceId: string): Promise<StorageSettings | null> {
  if (!usePostgres()) return structuredClone((await jsonFile.read(workspaceId)).settings[workspaceId] ?? null);
  const [row] = await getDb().select().from(schema.workspaceUploadStorage).where(eq(schema.workspaceUploadStorage.workspaceId, workspaceId)).limit(1);
  return row ? rowToSettings(row) : null;
}

/**
 * Read-modify-write under a lock. `change` returns the next settings, or
 * throws to abort without writing.
 */
export async function updateSettings(workspaceId: string, userId: string, change: (current: StorageSettings) => StorageSettings): Promise<StorageSettings> {
  if (!usePostgres()) {
    return jsonFile.update((data) => {
      const next = change(structuredClone(data.settings[workspaceId] ?? emptySettings(workspaceId, userId)));
      data.settings[workspaceId] = { ...next, workspaceId, updatedBy: userId, updatedAt: new Date().toISOString() };
      return structuredClone(data.settings[workspaceId]!);
    }, workspaceId);
  }
  return getDb().transaction(async (tx) => {
    await tx.insert(schema.workspaceUploadStorage).values({ workspaceId, updatedBy: userId }).onConflictDoNothing();
    const [row] = await tx.select().from(schema.workspaceUploadStorage).where(eq(schema.workspaceUploadStorage.workspaceId, workspaceId)).for('update');
    const next = change(rowToSettings(row!));
    const [saved] = await tx.update(schema.workspaceUploadStorage).set({
      target: next.target,
      drive: next.drive as unknown as Record<string, unknown> | null,
      driveSecretEncrypted: next.driveSecretEncrypted,
      database: next.database as unknown as Record<string, unknown> | null,
      databaseSecretEncrypted: next.databaseSecretEncrypted,
      updatedBy: userId,
      updatedAt: new Date(),
    }).where(eq(schema.workspaceUploadStorage.workspaceId, workspaceId)).returning();
    return rowToSettings(saved!);
  });
}

// ── Ledger ──────────────────────────────────────────────────────────────────

function rowToRecord(row: typeof schema.uploadLedger.$inferSelect): UploadRecord {
  return {
    id: row.id, workspaceId: row.workspaceId, fileId: row.fileId, userId: row.userId,
    target: row.target as UploadTarget, location: row.location, displayName: row.displayName,
    mime: row.mime, size: Number(row.size), sha256: row.sha256, sourceAppId: row.sourceAppId,
    status: row.status as UploadRecordStatus, errorCode: row.errorCode as UploadRecord['errorCode'],
    createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null,
  };
}

/**
 * Add a `pending` ledger row. When `limitBytes` is set, the row is added only
 * if used space plus this upload stays within it; the check and the insert
 * happen under one lock so parallel uploads cannot overshoot.
 */
export async function reserveUpload(record: UploadRecord, limitBytes: number | null): Promise<void> {
  if (!usePostgres()) {
    await jsonFile.update((data) => {
      const rows = data.ledger[record.workspaceId] ?? [];
      if (limitBytes !== null) {
        const now = Date.now();
        const used = rows.filter((row) => row.target === record.target && counts(row, now)).reduce((sum, row) => sum + row.size, 0);
        if (used + record.size > limitBytes) throw new QuotaExceededError();
      }
      rows.unshift(record);
      if (rows.length > JSON_LEDGER_CAP) {
        const keep = rows.filter((row, index) => index < JSON_LEDGER_CAP || LIVE.includes(row.status));
        data.ledger[record.workspaceId] = keep;
      } else {
        data.ledger[record.workspaceId] = rows;
      }
    }, record.workspaceId);
    return;
  }
  await getDb().transaction(async (tx) => {
    // The settings row is the per-workspace lock for reservations.
    await tx.insert(schema.workspaceUploadStorage).values({ workspaceId: record.workspaceId, updatedBy: record.userId }).onConflictDoNothing();
    await tx.select({ id: schema.workspaceUploadStorage.workspaceId }).from(schema.workspaceUploadStorage)
      .where(eq(schema.workspaceUploadStorage.workspaceId, record.workspaceId)).for('update');
    if (limitBytes !== null) {
      const since = new Date(Date.now() - PENDING_TTL_MS);
      const [used] = await tx.select({ bytes: dsql<string>`coalesce(sum(${schema.uploadLedger.size}), 0)::text` }).from(schema.uploadLedger).where(and(
        eq(schema.uploadLedger.workspaceId, record.workspaceId),
        eq(schema.uploadLedger.target, record.target),
        or(eq(schema.uploadLedger.status, 'stored'), and(eq(schema.uploadLedger.status, 'pending'), gt(schema.uploadLedger.createdAt, since))),
      ));
      if (Number(used?.bytes ?? 0) + record.size > limitBytes) throw new QuotaExceededError();
    }
    await tx.insert(schema.uploadLedger).values({
      ...record, createdAt: new Date(record.createdAt), completedAt: record.completedAt ? new Date(record.completedAt) : null,
    });
  });
}

/** Record a rejected upload (validation failed before any bytes were stored). */
export async function recordRejected(record: UploadRecord): Promise<void> {
  await reserveUpload(record, null);
}

export async function finishUpload(workspaceId: string, id: string, patch: Partial<Pick<UploadRecord, 'status' | 'errorCode' | 'location' | 'fileId'>>): Promise<void> {
  const completedAt = new Date().toISOString();
  if (!usePostgres()) {
    await jsonFile.update((data) => {
      const row = (data.ledger[workspaceId] ?? []).find((entry) => entry.id === id);
      if (row) Object.assign(row, patch, { completedAt });
    }, workspaceId);
    return;
  }
  await getDb().update(schema.uploadLedger).set({ ...patch, completedAt: new Date(completedAt) })
    .where(and(eq(schema.uploadLedger.workspaceId, workspaceId), eq(schema.uploadLedger.id, id)));
}

/** Mark the ledger row of a deleted Drive file. The row is kept as history. */
export async function markFileDeleted(workspaceId: string, fileId: string): Promise<void> {
  if (!usePostgres()) {
    await jsonFile.update((data) => {
      for (const row of data.ledger[workspaceId] ?? []) {
        if (row.fileId === fileId && row.status === 'stored') row.status = 'deleted';
      }
    }, workspaceId);
    return;
  }
  await getDb().update(schema.uploadLedger).set({ status: 'deleted' }).where(and(
    eq(schema.uploadLedger.workspaceId, workspaceId), eq(schema.uploadLedger.fileId, fileId), eq(schema.uploadLedger.status, 'stored'),
  ));
}

export async function usage(workspaceId: string, target: UploadTarget): Promise<{ usedBytes: number; fileCount: number }> {
  if (!usePostgres()) {
    const now = Date.now();
    const rows = ((await jsonFile.read(workspaceId)).ledger[workspaceId] ?? []).filter((row) => row.target === target && counts(row, now));
    return { usedBytes: rows.reduce((sum, row) => sum + row.size, 0), fileCount: rows.filter((row) => row.status === 'stored').length };
  }
  const since = new Date(Date.now() - PENDING_TTL_MS);
  const [row] = await getDb().select({
    bytes: dsql<string>`coalesce(sum(${schema.uploadLedger.size}), 0)::text`,
    files: dsql<string>`count(*) filter (where ${schema.uploadLedger.status} = 'stored')::text`,
  }).from(schema.uploadLedger).where(and(
    eq(schema.uploadLedger.workspaceId, workspaceId),
    eq(schema.uploadLedger.target, target),
    or(eq(schema.uploadLedger.status, 'stored'), and(eq(schema.uploadLedger.status, 'pending'), gt(schema.uploadLedger.createdAt, since))),
  ));
  return { usedBytes: Number(row?.bytes ?? 0), fileCount: Number(row?.files ?? 0) };
}

/** Number of live files stored on a target; a target with files cannot be disconnected. */
export async function liveFileCount(workspaceId: string, target: UploadTarget): Promise<number> {
  return (await usage(workspaceId, target)).fileCount;
}

export async function recentUploads(workspaceId: string, limit = 25): Promise<UploadRecord[]> {
  if (!usePostgres()) {
    return structuredClone(((await jsonFile.read(workspaceId)).ledger[workspaceId] ?? []).slice(0, limit));
  }
  const rows = await getDb().select().from(schema.uploadLedger)
    .where(eq(schema.uploadLedger.workspaceId, workspaceId))
    .orderBy(desc(schema.uploadLedger.createdAt)).limit(limit);
  return rows.map(rowToRecord);
}

/** Ledger rows for specific files (used when serving a file to check its stored SHA-256). */
export async function ledgerForFiles(workspaceId: string, fileIds: string[]): Promise<UploadRecord[]> {
  if (fileIds.length === 0) return [];
  if (!usePostgres()) {
    return ((await jsonFile.read(workspaceId)).ledger[workspaceId] ?? []).filter((row) => row.fileId !== null && fileIds.includes(row.fileId));
  }
  const rows = await getDb().select().from(schema.uploadLedger).where(and(
    eq(schema.uploadLedger.workspaceId, workspaceId), inArray(schema.uploadLedger.fileId, fileIds),
  ));
  return rows.map(rowToRecord);
}
