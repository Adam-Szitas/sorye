import { isIP } from 'node:net';
import postgres from 'postgres';
import { FILE_MAX_BYTES, type OwnStorageErrorCode } from '@sorye/types';
import { HostNotAllowedError, resolvePublicAddress } from './net-guard';
import type { DatabaseConfig, DatabaseSecret } from './validate';

/**
 * Customer PostgreSQL database. Sorye works only inside the schema the owner
 * named, in one table (`<schema>.files`). The connection is pinned to the
 * address that passed the public-address check, and TLS is verified against
 * the host name the owner typed.
 */

const STATEMENT_TIMEOUT_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export class DatabaseError extends Error {
  constructor(readonly code: OwnStorageErrorCode) {
    super(code);
    this.name = 'DatabaseError';
  }
}

/** SQL the owner can run themselves to give Sorye only what it needs. Identifiers are already validated. */
export function setupSql(config: Pick<DatabaseConfig, 'schema' | 'user'>): string {
  return [
    `CREATE SCHEMA IF NOT EXISTS ${config.schema} AUTHORIZATION "${config.user}";`,
    `CREATE TABLE IF NOT EXISTS ${config.schema}.files (`,
    '  id uuid PRIMARY KEY,',
    '  workspace_id text NOT NULL,',
    '  file_name text NOT NULL,',
    '  mime text NOT NULL,',
    '  size bigint NOT NULL CHECK (size >= 0),',
    '  sha256 char(64) NOT NULL,',
    '  content bytea NOT NULL,',
    '  created_at timestamptz NOT NULL DEFAULT now(),',
    '  CHECK (octet_length(content) = size)',
    ');',
  ].join('\n');
}

export function databaseErrorCode(error: unknown): OwnStorageErrorCode {
  if (error instanceof DatabaseError) return error.code;
  if (error instanceof HostNotAllowedError) return error.reason;
  const e = error as { code?: string; errno?: string; message?: string };
  const code = String(e?.code ?? e?.errno ?? '');
  if (code === '28P01' || code === '28000') return 'auth_failed';
  if (code === '3D000') return 'not_found';
  if (code === '42501') return 'permission_denied';
  if (code === '53100') return 'quota_exceeded';
  if (code === 'CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || code === '57014') return 'timeout';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'host_unresolved';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'CONNECTION_CLOSED' || code === 'CONNECTION_ENDED') return 'unreachable';
  if (/^(?:CERT_|ERR_TLS_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|ERR_SSL|EPROTO)/.test(code)) return 'tls_failed';
  if (/does not support SSL|SSL connection|certificate/i.test(e?.message ?? '')) return 'tls_failed';
  return 'storage_unavailable';
}

async function open(config: DatabaseConfig, secret: DatabaseSecret, allowPrivate: boolean) {
  const { address } = await resolvePublicAddress(config.host, allowPrivate);
  const servername = isIP(config.host) ? undefined : config.host;
  const ssl =
    config.tls === 'disable' ? false
    : config.tls === 'encrypt' ? { rejectUnauthorized: false, servername, minVersion: 'TLSv1.2' as const }
    : { rejectUnauthorized: true, servername, minVersion: 'TLSv1.2' as const, ...(secret.caPem ? { ca: secret.caPem } : {}) };
  return postgres({
    host: address,
    port: config.port,
    database: config.database,
    username: config.user,
    password: secret.password,
    ssl,
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 1,
    max_lifetime: 60,
    onnotice: () => undefined,
    connection: { application_name: 'sorye-uploads', statement_timeout: STATEMENT_TIMEOUT_MS },
  });
}

async function run<T>(config: DatabaseConfig, secret: DatabaseSecret, allowPrivate: boolean, action: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  let sql: postgres.Sql | null = null;
  try {
    sql = await open(config, secret, allowPrivate);
    return await action(sql);
  } catch (error) {
    throw new DatabaseError(databaseErrorCode(error));
  } finally {
    if (sql) await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

function table(sql: postgres.Sql, config: DatabaseConfig) {
  return sql(`${config.schema}.files`);
}

/**
 * Prove the connection works before saving it: the schema and table exist (or
 * are created), and Sorye can insert, read and delete a row. The probe row is
 * written inside a transaction that is rolled back.
 */
export async function verifyDatabase(config: DatabaseConfig, secret: DatabaseSecret, allowPrivate: boolean): Promise<{ tableBytes: number | null }> {
  return run(config, secret, allowPrivate, async (sql) => {
    await sql`select 1`;
    const [found] = await sql<{ regclass: string | null }[]>`select to_regclass(${`${config.schema}.files`})::text as regclass`;
    if (!found?.regclass) {
      // CREATE SCHEMA ... IF NOT EXISTS still needs CREATE on the database, which a
      // least-privilege role (the documented setup) does not have: only create it when missing.
      const [schemaRow] = await sql<{ present: boolean }[]>`select exists(select 1 from pg_namespace where nspname = ${config.schema}) as present`;
      if (!schemaRow?.present) await sql`create schema ${sql(config.schema)}`;
      await sql.unsafe(setupSql(config).split('\n').slice(1).join('\n'));
    }
    const [rights] = await sql<{ ok: boolean }[]>`
      select has_table_privilege(current_user, ${`${config.schema}.files`}, 'SELECT')
         and has_table_privilege(current_user, ${`${config.schema}.files`}, 'INSERT')
         and has_table_privilege(current_user, ${`${config.schema}.files`}, 'DELETE') as ok`;
    if (!rights?.ok) throw new DatabaseError('permission_denied');
    const probe = Buffer.from('sorye connection check');
    await sql.begin(async (tx) => {
      const id = crypto.randomUUID();
      await tx`insert into ${table(tx as unknown as postgres.Sql, config)} (id, workspace_id, file_name, mime, size, sha256, content)
        values (${id}, ${'connection-check'}, ${'check.txt'}, ${'text/plain'}, ${probe.length}, ${'0'.repeat(64)}, ${probe})`;
      const [row] = await tx<{ content: Buffer }[]>`select content from ${table(tx as unknown as postgres.Sql, config)} where id = ${id}`;
      if (!row || !Buffer.from(row.content).equals(probe)) throw new DatabaseError('integrity_failed');
      // Never keep the probe: roll the transaction back.
      throw new RollbackProbe();
    }).catch((error) => {
      if (!(error instanceof RollbackProbe)) throw error;
    });
    return { tableBytes: await measure(sql, config) };
  });
}

class RollbackProbe extends Error {}

async function measure(sql: postgres.Sql, config: DatabaseConfig): Promise<number | null> {
  const [row] = await sql<{ bytes: string | null }[]>`select pg_total_relation_size(to_regclass(${`${config.schema}.files`}))::text as bytes`;
  const bytes = row?.bytes == null ? null : Number(row.bytes);
  return bytes !== null && Number.isFinite(bytes) ? bytes : null;
}

export async function measureDatabase(config: DatabaseConfig, secret: DatabaseSecret, allowPrivate: boolean): Promise<number | null> {
  return run(config, secret, allowPrivate, (sql) => measure(sql, config));
}

export async function putDatabaseRow(
  config: DatabaseConfig, secret: DatabaseSecret, allowPrivate: boolean,
  row: { id: string; workspaceId: string; fileName: string; mime: string; sha256: string; bytes: Buffer },
): Promise<void> {
  if (!UUID_RE.test(row.id) || !ID_RE.test(row.workspaceId)) throw new DatabaseError('invalid_input');
  await run(config, secret, allowPrivate, async (sql) => {
    await sql`insert into ${table(sql, config)} (id, workspace_id, file_name, mime, size, sha256, content)
      values (${row.id}, ${row.workspaceId}, ${row.fileName}, ${row.mime}, ${row.bytes.length}, ${row.sha256}, ${row.bytes})`;
  });
}

export async function getDatabaseRow(config: DatabaseConfig, secret: DatabaseSecret, allowPrivate: boolean, id: string, workspaceId: string): Promise<Buffer> {
  if (!UUID_RE.test(id) || !ID_RE.test(workspaceId)) throw new DatabaseError('invalid_input');
  return run(config, secret, allowPrivate, async (sql) => {
    const [row] = await sql<{ content: Buffer; size: string }[]>`
      select content, size::text as size from ${table(sql, config)} where id = ${id} and workspace_id = ${workspaceId}`;
    if (!row) throw new DatabaseError('not_found');
    const bytes = Buffer.from(row.content);
    if (bytes.length > FILE_MAX_BYTES) throw new DatabaseError('integrity_failed');
    return bytes;
  });
}

export async function deleteDatabaseRow(config: DatabaseConfig, secret: DatabaseSecret, allowPrivate: boolean, id: string, workspaceId: string): Promise<void> {
  if (!UUID_RE.test(id) || !ID_RE.test(workspaceId)) throw new DatabaseError('invalid_input');
  await run(config, secret, allowPrivate, async (sql) => {
    await sql`delete from ${table(sql, config)} where id = ${id} and workspace_id = ${workspaceId}`;
  });
}
