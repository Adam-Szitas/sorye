/** How workspace app data (Canvas, Messenger, …) is persisted. */
export type WorkspaceStorageDriver = 'default' | 'postgres';

export type WorkspaceStorageStatus =
  | 'default'
  | 'connected'
  | 'error';

/** Safe to expose to the client — never includes connection strings. */
export interface WorkspaceStoragePublic {
  driver: WorkspaceStorageDriver;
  status: WorkspaceStorageStatus;
  /** e.g. db.example.com */
  hostHint?: string;
  /** e.g. my_app */
  databaseHint?: string;
  updatedAt?: string;
  lastError?: string;
}

export interface WorkspaceStorageInfo extends WorkspaceStoragePublic {
  /** What the hub deployment uses when driver is `default`. */
  hubDefaultDriver: 'json' | 'postgres';
}

export const DEFAULT_WORKSPACE_STORAGE: WorkspaceStoragePublic = {
  driver: 'default',
  status: 'default',
};
