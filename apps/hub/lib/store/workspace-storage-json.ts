import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { WorkspaceStorageRecord } from '@/lib/workspace-storage-util';
import {
  decryptSecret,
  encryptSecret,
  hintsFromDatabaseUrl,
} from '@/lib/storage-crypto';
import { testPostgresConnection, toPublicStorage } from '@/lib/workspace-storage-util';

const DATA_DIR = path.join(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'workspace-storage.json');

type StoreData = Record<string, WorkspaceStorageRecord>;

async function readStore(): Promise<StoreData> {
  try {
    const raw = await readFile(STORE_PATH, 'utf-8');
    return JSON.parse(raw) as StoreData;
  } catch {
    return {};
  }
}

async function writeStore(data: StoreData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

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

  const store = await readStore();
  store[workspaceId] = record;
  await writeStore(store);
  return record;
}

export async function clearWorkspaceStorage(
  workspaceId: string,
): Promise<void> {
  const store = await readStore();
  delete store[workspaceId];
  await writeStore(store);
}

export async function markWorkspaceStorageError(
  workspaceId: string,
  message: string,
): Promise<void> {
  const store = await readStore();
  const current = store[workspaceId];
  if (!current || current.driver !== 'postgres') return;
  store[workspaceId] = {
    ...current,
    status: 'error',
    lastError: message,
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);
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
