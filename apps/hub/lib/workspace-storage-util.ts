import postgres from 'postgres';
import type {
  WorkspaceStorageDriver,
  WorkspaceStoragePublic,
  WorkspaceStorageStatus,
} from '@sorye/types';
import { DEFAULT_WORKSPACE_STORAGE } from '@sorye/types';

export interface WorkspaceStorageRecord {
  driver: WorkspaceStorageDriver;
  status: WorkspaceStorageStatus;
  hostHint?: string;
  databaseHint?: string;
  updatedAt?: string;
  lastError?: string;
  databaseUrlEncrypted?: string;
}

export function toPublicStorage(
  record: WorkspaceStorageRecord | undefined,
): WorkspaceStoragePublic {
  if (!record || record.driver === 'default' || !record.databaseUrlEncrypted) {
    return { ...DEFAULT_WORKSPACE_STORAGE };
  }
  return {
    driver: 'postgres',
    status: record.status === 'connected' ? 'connected' : record.status,
    hostHint: record.hostHint,
    databaseHint: record.databaseHint,
    updatedAt: record.updatedAt,
    lastError: record.lastError,
  };
}

export async function testPostgresConnection(
  databaseUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let sql: ReturnType<typeof postgres> | null = null;
  try {
    sql = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 8,
      idle_timeout: 2,
      ssl: databaseUrl.includes('sslmode=require') ? 'require' : undefined,
    });
    await sql`select 1 as ok`;
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  } finally {
    if (sql) await sql.end({ timeout: 2 });
  }
}
