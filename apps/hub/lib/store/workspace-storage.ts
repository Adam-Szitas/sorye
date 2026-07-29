import { getStoreDriver } from '@/lib/env';
import * as jsonStore from './workspace-storage-json';
import * as postgresStore from './workspace-storage-postgres';

function activeStore() {
  return getStoreDriver() === 'postgres' ? postgresStore : jsonStore;
}

export const getWorkspaceStorageRecord = (
  ...args: Parameters<typeof jsonStore.getWorkspaceStorageRecord>
) => activeStore().getWorkspaceStorageRecord(...args);

export const getWorkspaceStoragePublic = (
  ...args: Parameters<typeof jsonStore.getWorkspaceStoragePublic>
) => activeStore().getWorkspaceStoragePublic(...args);

export const setWorkspacePostgresUrl = (
  ...args: Parameters<typeof jsonStore.setWorkspacePostgresUrl>
) => activeStore().setWorkspacePostgresUrl(...args);

export const clearWorkspaceStorage = (
  ...args: Parameters<typeof jsonStore.clearWorkspaceStorage>
) => activeStore().clearWorkspaceStorage(...args);

export const markWorkspaceStorageError = (
  ...args: Parameters<typeof jsonStore.markWorkspaceStorageError>
) => activeStore().markWorkspaceStorageError(...args);

export const getWorkspaceDatabaseUrl = (
  ...args: Parameters<typeof jsonStore.getWorkspaceDatabaseUrl>
) => activeStore().getWorkspaceDatabaseUrl(...args);
