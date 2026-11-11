import postgres from 'postgres';
import type {
  WorkspaceStorageDriver,
  WorkspaceStoragePublic,
  WorkspaceStorageStatus,
} from '@sorye/types';
import { DEFAULT_WORKSPACE_STORAGE } from '@sorye/types';
import { databaseErrorCode } from '@/lib/upload-storage/database';
import { HostNotAllowedError } from '@/lib/upload-storage/net-guard';
import { PgUrlError, safePostgresOptions } from '@/lib/upload-storage/pg-url';
import { devInsecure } from '@/lib/upload-storage/mode';

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

/**
 * Fixed messages per failure. Driver and server messages are never returned:
 * they would let a caller probe hosts and ports through the Hub.
 */
const MESSAGES: Record<string, string> = {
  invalid_input: 'The connection string is not a valid PostgreSQL URL.',
  tls_required: 'TLS is required. Remove sslmode=disable.',
  host_not_allowed: 'This host is not allowed: it resolves to a private, internal or reserved address.',
  host_unresolved: 'The host name could not be resolved.',
  auth_failed: 'The user name or password was refused.',
  not_found: 'The database does not exist.',
  tls_failed: 'The TLS connection failed. Check that the server supports TLS and, with verify-full, that its certificate matches the host.',
  timeout: 'The database did not answer in time.',
};
const FALLBACK = 'Could not connect to the database. Check the connection string and that the server accepts connections from Sorye.';

export async function testPostgresConnection(
  databaseUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let sql: ReturnType<typeof postgres> | null = null;
  try {
    const options = await safePostgresOptions(databaseUrl, devInsecure());
    sql = postgres({ ...options, max: 1, connect_timeout: 8, idle_timeout: 2 });
    await sql`select 1 as ok`;
    return { ok: true };
  } catch (err) {
    const code = err instanceof PgUrlError ? err.reason : err instanceof HostNotAllowedError ? err.reason : databaseErrorCode(err);
    return { ok: false, error: MESSAGES[code] ?? FALLBACK };
  } finally {
    if (sql) await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}
