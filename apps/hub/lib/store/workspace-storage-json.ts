import type { WorkspaceStorageRecord } from '@/lib/workspace-storage-util';
import {
  decryptSecret,
  encryptSecret,
  hintsFromDatabaseUrl,
} from '@/lib/storage-crypto';
import { jsonDataFile } from '@/lib/store/json-file';
import { testPostgresConnection, toPublicStorage } from '@/lib/workspace-storage-util';

type StoreData = Record<string, WorkspaceStorageRecord>;

const storeFile = jsonDataFile<StoreData>('workspace-storage.json', () => ({}));

const readStore = () => storeFile.read();

export async function getWorkspaceStorageRecord(
  workspaceId: string,
): Promise<WorkspaceStorageRecord | undefined> {
  const store = await readStore();
  return store[workspaceId];
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
  const record: WorkspaceStorageRecord = {
    driver: 'postgres',
    status: 'connected',
    hostHint: hints.hostHint,
    databaseHint: hints.databaseHint,
    updatedAt: new Date().toISOString(),
    lastError: undefined,
    databaseUrlEncrypted: encryptSecret(databaseUrl),
  };

  await storeFile.update((store) => {
    store[workspaceId] = record;
  });
  return record;
}

export async function clearWorkspaceStorage(
  workspaceId: string,
): Promise<void> {
  await storeFile.update((store) => {
    delete store[workspaceId];
  });
}

export async function markWorkspaceStorageError(
  workspaceId: string,
  message: string,
): Promise<void> {
  await storeFile.update((store) => {
    const current = store[workspaceId];
    if (!current || current.driver !== 'postgres') return;
    store[workspaceId] = {
      ...current,
      status: 'error',
      lastError: message,
      updatedAt: new Date().toISOString(),
    };
  });
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
