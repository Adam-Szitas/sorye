import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@sorye/db/schema';
import { getStoreDriver } from '@/lib/env';
import {
  getWorkspaceDatabaseUrl,
  markWorkspaceStorageError,
} from '@/lib/store/workspace-storage';

type WorkspaceDb = ReturnType<typeof drizzle<typeof schema>>;

export type { WorkspaceDb };

const pools = new Map<string, ReturnType<typeof postgres>>();

export function getHubDefaultDriver(): 'json' | 'postgres' {
  return getStoreDriver();
}

export async function getWorkspaceDb(
  workspaceId: string,
): Promise<WorkspaceDb | null> {
  const url = await getWorkspaceDatabaseUrl(workspaceId);
  if (!url) return null;

  let sql = pools.get(workspaceId);
  if (!sql) {
    sql = postgres(url, {
      max: 5,
      idle_timeout: 30,
      connect_timeout: 10,
      ssl: url.includes('sslmode=require') ? 'require' : undefined,
    });
    pools.set(workspaceId, sql);
  }

  return drizzle(sql, { schema });
}

/** Run against workspace DB when configured; otherwise use hub default store fn. */
export async function withWorkspaceDb<T>(
  workspaceId: string,
  external: (db: WorkspaceDb) => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  const db = await getWorkspaceDb(workspaceId);
  if (!db) return fallback();
  try {
    return await external(db);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Workspace DB error';
    await markWorkspaceStorageError(workspaceId, message);
    return fallback();
  }
}
