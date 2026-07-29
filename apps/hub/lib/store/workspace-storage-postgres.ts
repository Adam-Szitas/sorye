import { eq } from 'drizzle-orm';
import { getDb } from '@sorye/db';
import * as schema from '@sorye/db/schema';
import type { WorkspaceStorageRecord } from '@/lib/workspace-storage-util';
import {
  decryptSecret,
  encryptSecret,
  hintsFromDatabaseUrl,
} from '@/lib/storage-crypto';
import { testPostgresConnection, toPublicStorage } from '@/lib/workspace-storage-util';

function rowToRecord(
  row: typeof schema.workspaces.$inferSelect,
): WorkspaceStorageRecord | undefined {
  if (row.storageDriver === 'default' || !row.databaseUrlEncrypted) {
    return undefined;
  }
  return {
    driver: 'postgres',
    status:
      row.storageStatus === 'connected' || row.storageStatus === 'error'
        ? row.storageStatus
        : 'connected',
    hostHint: row.storageHostHint ?? undefined,
    databaseHint: row.storageDatabaseHint ?? undefined,
    updatedAt: row.storageUpdatedAt?.toISOString(),
    lastError: row.storageLastError ?? undefined,
    databaseUrlEncrypted: row.databaseUrlEncrypted,
  };
}

export async function getWorkspaceStorageRecord(
  workspaceId: string,
): Promise<WorkspaceStorageRecord | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return row ? rowToRecord(row) : undefined;
}

export function getWorkspaceStoragePublic(
  record: WorkspaceStorageRecord | undefined,
) {
  return toPublicStorage(record);
}

export async function setWorkspacePostgresUrl(
  workspaceId: string,
  databaseUrl: string,
): Promise<WorkspaceStorageRecord> {
  const test = await testPostgresConnection(databaseUrl);
  if (!test.ok) {
    throw new Error(test.error);
  }

  const hints = hintsFromDatabaseUrl(databaseUrl);
  const encrypted = encryptSecret(databaseUrl);
  const now = new Date();

  const db = getDb();
  await db
    .update(schema.workspaces)
    .set({
      storageDriver: 'postgres',
      storageStatus: 'connected',
      storageHostHint: hints.hostHint,
      storageDatabaseHint: hints.databaseHint,
      storageLastError: null,
      databaseUrlEncrypted: encrypted,
      storageUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.workspaces.id, workspaceId));

  return {
    driver: 'postgres',
    status: 'connected',
    hostHint: hints.hostHint,
    databaseHint: hints.databaseHint,
    updatedAt: now.toISOString(),
    databaseUrlEncrypted: encrypted,
  };
}

export async function clearWorkspaceStorage(
  workspaceId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.workspaces)
    .set({
      storageDriver: 'default',
      storageStatus: 'default',
      storageHostHint: null,
      storageDatabaseHint: null,
      storageLastError: null,
      databaseUrlEncrypted: null,
      storageUpdatedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, workspaceId));
}

export async function markWorkspaceStorageError(
  workspaceId: string,
  message: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.workspaces)
    .set({
      storageStatus: 'error',
      storageLastError: message.slice(0, 500),
      storageUpdatedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, workspaceId));
}

export async function getWorkspaceDatabaseUrl(
  workspaceId: string,
): Promise<string | null> {
  const record = await getWorkspaceStorageRecord(workspaceId);
  if (!record?.databaseUrlEncrypted || record.driver !== 'postgres') {
    return null;
  }
  if (record.status !== 'connected') return null;
  try {
    return decryptSecret(record.databaseUrlEncrypted);
  } catch {
    return null;
  }
}
