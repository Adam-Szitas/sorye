import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@sorye/db/schema';
import { getStoreDriver } from '@/lib/env';
import { WorkspaceDocConflict } from './store/workspace-doc-conflict';
import {
  getWorkspaceDatabaseUrl,
  markWorkspaceStorageError,
} from '@/lib/store/workspace-storage';

type WorkspaceDb = ReturnType<typeof drizzle<typeof schema>>;

export type { WorkspaceDb };

export class WorkspaceDatabaseUnavailableError extends Error {
  readonly code = 'WORKSPACE_DATABASE_UNAVAILABLE';

  constructor() {
    super('The configured workspace database is unavailable. Please retry shortly.');
    this.name = 'WorkspaceDatabaseUnavailableError';
  }
}

function isDatabaseFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && (/^[0-9A-Z]{5}$/.test(code) || /^(?:E[A-Z]+|CONNECTION_|CONNECT_)/.test(code))) return true;
  const message = error instanceof Error ? error.message : '';
  return /connection (?:terminated|closed|refused|timed out)|connect(?:ion)? timed out|socket hang up|server closed the connection/i.test(message);
}

interface WorkspacePool {
  workspaceId: string;
  fingerprint: string;
  sql: ReturnType<typeof postgres>;
  db: WorkspaceDb;
  active: number;
  lastUsed: number;
  closed: boolean;
}

// Per-process safety budget: at most 16 tenant pools × 3 connections, in
// addition to the Hub's own pool. Fleet-wide capacity must account for replicas.
const MAX_WORKSPACE_POOLS = 16;
const WORKSPACE_POOL_CONNECTIONS = 3;
const poolsByWorkspace = new Map<string, WorkspacePool>();
const livePools = new Set<WorkspacePool>();

async function closePool(pool: WorkspacePool): Promise<void> {
  if (pool.closed || pool.active > 0) return;
  pool.closed = true;
  livePools.delete(pool);
  await pool.sql.end({ timeout: 5 }).catch(() => undefined);
}

async function evictIdlePool(): Promise<boolean> {
  const candidate = [...livePools].filter((pool) => pool.active === 0)
    .sort((a, b) => a.lastUsed - b.lastUsed)[0];
  if (!candidate) return false;
  if (poolsByWorkspace.get(candidate.workspaceId) === candidate) {
    poolsByWorkspace.delete(candidate.workspaceId);
  }
  await closePool(candidate);
  return true;
}

async function acquireWorkspaceDb(workspaceId: string): Promise<{ db: WorkspaceDb; release: () => void } | null> {
  const url = await getWorkspaceDatabaseUrl(workspaceId);
  if (!url) return null;
  const fingerprint = createHash('sha256').update(url).digest('hex');
  let pool = poolsByWorkspace.get(workspaceId);

  if (pool && pool.fingerprint !== fingerprint) {
    poolsByWorkspace.delete(workspaceId);
    if (pool.active === 0) await closePool(pool);
    else pool = undefined;
    pool = undefined;
  }

  if (!pool || pool.closed) {
    while (livePools.size >= MAX_WORKSPACE_POOLS) {
      if (!(await evictIdlePool())) throw new WorkspaceDatabaseUnavailableError();
    }
    const sqlClient = postgres(url, {
      max: WORKSPACE_POOL_CONNECTIONS,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: url.includes('sslmode=require') ? 'require' : undefined,
    });
    pool = { workspaceId, fingerprint, sql: sqlClient, db: drizzle(sqlClient, { schema }), active: 0, lastUsed: Date.now(), closed: false };
    poolsByWorkspace.set(workspaceId, pool);
    livePools.add(pool);
  }

  pool.active += 1;
  pool.lastUsed = Date.now();
  let released = false;
  return {
    db: pool.db,
    release: () => {
      if (released) return;
      released = true;
      pool!.active = Math.max(0, pool!.active - 1);
      pool!.lastUsed = Date.now();
      if (pool!.active === 0 && (pool!.closed || poolsByWorkspace.get(workspaceId) !== pool)) {
        void closePool(pool!);
      }
    },
  };
}

export function getHubDefaultDriver(): 'json' | 'postgres' {
  return getStoreDriver();
}

/** Use the Hub store only when no workspace database is configured. */
export async function withWorkspaceDb<T>(
  workspaceId: string,
  external: (db: WorkspaceDb) => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  let lease: Awaited<ReturnType<typeof acquireWorkspaceDb>>;
  try {
    lease = await acquireWorkspaceDb(workspaceId);
  } catch {
    throw new WorkspaceDatabaseUnavailableError();
  }
  if (!lease) return fallback();
  try {
    return await external(lease.db);
  } catch (err) {
    if (err instanceof WorkspaceDocConflict) throw err;
    if (!isDatabaseFailure(err)) throw err;
    const message = 'Workspace database operation failed. Check the configured database and retry.';
    await markWorkspaceStorageError(workspaceId, message).catch(() => undefined);
    throw new WorkspaceDatabaseUnavailableError();
  } finally {
    lease.release();
  }
}
