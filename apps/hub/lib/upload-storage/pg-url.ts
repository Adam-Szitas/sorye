import { isIP } from 'node:net';
import type { Options } from 'postgres';
import { normalizeHost, resolvePublicAddress } from './net-guard';

/**
 * Turn a customer PostgreSQL URL into connection options that cannot reach
 * private networks and always use TLS:
 * - the host must resolve only to public addresses; the connection is pinned
 *   to the checked address (DNS rebinding cannot redirect it);
 * - `sslmode=verify-full` / `verify-ca` verify the certificate against the
 *   host name; any other mode (including none) still encrypts;
 * - `sslmode=disable` is refused unless the development-only insecure mode is on.
 */

export class PgUrlError extends Error {
  constructor(readonly reason: 'invalid_input' | 'tls_required') {
    super(reason);
    this.name = 'PgUrlError';
  }
}

export async function safePostgresOptions(databaseUrl: string, allowInsecure: boolean): Promise<Options<Record<string, never>>> {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new PgUrlError('invalid_input');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new PgUrlError('invalid_input');
  const host = normalizeHost(decodeURIComponent(url.hostname), allowInsecure);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const port = url.port ? Number(url.port) : 5432;
  if (!host || !database || database.includes('/') || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PgUrlError('invalid_input');
  }
  const sslmode = (url.searchParams.get('sslmode') ?? '').toLowerCase();
  if (sslmode === 'disable' && !allowInsecure) throw new PgUrlError('tls_required');
  const { address } = await resolvePublicAddress(host, allowInsecure);
  const servername = isIP(host) ? undefined : host;
  const ssl =
    sslmode === 'disable' ? false
    : sslmode === 'verify-full' || sslmode === 'verify-ca' ? { rejectUnauthorized: true, servername, minVersion: 'TLSv1.2' as const }
    : { rejectUnauthorized: false, servername, minVersion: 'TLSv1.2' as const };
  return {
    host: address,
    port,
    database,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl,
    prepare: false,
    onnotice: () => undefined,
  };
}
