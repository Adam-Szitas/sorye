import { APP_CATALOG } from '@sorye/types';

/**
 * Exact-host routing for Hub. Edge-safe: no Node imports, env read by literal name
 * so the middleware bundle records each variable.
 *
 * - customer: the workspace Hub (`sorye.app`)
 * - admin: the administration console (`admin.sorye.app`)
 * - app: an exact catalog subdomain (`tasks.sorye.app`)
 * - unknown: anything else; never an OAuth, redirect or cookie origin
 */
export type HostKind = 'customer' | 'admin' | 'app' | 'unknown';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const HOSTNAME = /^[a-z0-9.-]{1,253}$/;

export interface HostConfig {
  production: boolean;
  publicHost: string;
  adminHost: string;
  extraHosts: Set<string>;
}

function cleanHost(value: string | undefined): string | null {
  const host = value?.trim().toLowerCase();
  if (!host || !HOSTNAME.test(host) || host.startsWith('.') || host.endsWith('.')) return null;
  return host;
}

export function hostConfig(env: {
  NODE_ENV?: string;
  SORYE_PUBLIC_HOST?: string;
  SORYE_ADMIN_HOST?: string;
  SORYE_EXTRA_HOSTS?: string;
} = {
  NODE_ENV: process.env.NODE_ENV,
  SORYE_PUBLIC_HOST: process.env.SORYE_PUBLIC_HOST,
  SORYE_ADMIN_HOST: process.env.SORYE_ADMIN_HOST,
  SORYE_EXTRA_HOSTS: process.env.SORYE_EXTRA_HOSTS,
}): HostConfig {
  const production = env.NODE_ENV === 'production';
  const publicHost = cleanHost(env.SORYE_PUBLIC_HOST) ?? 'sorye.app';
  const adminHost = cleanHost(env.SORYE_ADMIN_HOST) ?? (production ? `admin.${publicHost}` : 'admin.localhost');
  const extraHosts = new Set(
    (env.SORYE_EXTRA_HOSTS ?? '').split(',').map((host) => cleanHost(host)).filter((host): host is string => Boolean(host)),
  );
  return { production, publicHost, adminHost, extraHosts };
}

/** Hostname without port. IPv6 literals keep their brackets. */
export function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 0 ? value.slice(0, end + 1) : value;
  }
  const colon = value.lastIndexOf(':');
  return colon > 0 ? value.slice(0, colon) : value;
}

export function portOf(hostHeader: string): string {
  const value = hostHeader.trim();
  const tail = value.startsWith('[') ? value.slice(value.indexOf(']') + 1) : value;
  const match = /:(\d{1,5})$/.exec(tail);
  return match ? match[1] : '';
}

/**
 * The host the browser used. A trusted ingress overwrites X-Forwarded-Host;
 * Auth.js (trustHost) reads the same header first, so both agree.
 */
export function effectiveHost(headers: Headers): { host: string; forwarded: boolean } {
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwarded) return { host: forwarded, forwarded: true };
  return { host: headers.get('host')?.trim() ?? '', forwarded: false };
}

function catalogAppHost(hostname: string, config: HostConfig): boolean {
  return APP_CATALOG.some((app) => hostname === `${app.slug}.${config.publicHost}`);
}

export function classifyHost(
  hostHeader: string,
  options: { forwarded: boolean },
  config: HostConfig = hostConfig(),
): HostKind {
  const hostname = hostnameOf(hostHeader);
  if (!hostname) return 'unknown';
  if (hostname === config.adminHost) return 'admin';
  if (hostname === config.publicHost || config.extraHosts.has(hostname)) return 'customer';
  if (catalogAppHost(hostname, config)) return 'app';
  // Development accepts LAN and container hostnames; only the exact admin host is admin.
  if (!config.production) return 'customer';
  // Container healthchecks call Hub directly on loopback without a forwarding proxy.
  if (!options.forwarded && LOOPBACK.has(hostname)) return 'customer';
  return 'unknown';
}

/** Origin of the administration console, keeping the dev port of the current request. */
export function adminOrigin(requestHost: string, protocol: string, config: HostConfig = hostConfig()): string {
  if (config.production) return `https://${config.adminHost}`;
  const port = portOf(requestHost);
  const scheme = protocol === 'https:' || protocol === 'https' ? 'https' : 'http';
  return `${scheme}://${config.adminHost}${port ? `:${port}` : ''}`;
}

/** Customer Hub origin for links out of the console. */
export function customerOrigin(requestHost: string, protocol: string, config: HostConfig = hostConfig()): string {
  if (config.production) return `https://${config.publicHost}`;
  const port = portOf(requestHost);
  const scheme = protocol === 'https:' || protocol === 'https' ? 'https' : 'http';
  return `${scheme}://localhost${port ? `:${port}` : ''}`;
}

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Routes the admin hostname serves. Everything else is 404 there. */
export function isAdminSurfacePath(pathname: string, production: boolean): boolean {
  return (
    under(pathname, '/admin') ||
    under(pathname, '/api/admin') ||
    under(pathname, '/api/operator') ||
    pathname === '/api/backend/topology' ||
    pathname === '/api/backend/capabilities' ||
    under(pathname, '/api/auth') ||
    pathname === '/login' ||
    under(pathname, '/_next') ||
    pathname === '/favicon.ico' ||
    (!production && pathname.startsWith('/__nextjs'))
  );
}

/** Platform-admin APIs that only the admin hostname may reach. */
export function isAdminOnlyApi(pathname: string): boolean {
  if (pathname === '/api/admin/subscription') return false;
  return under(pathname, '/api/admin') || under(pathname, '/api/operator');
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Mutation origin check. Sibling subdomains are same-site, so SameSite cookies do
 * not isolate admin.sorye.app from tasks.sorye.app; compare exact origins instead.
 * Non-browser callers send neither header and still need their own credentials.
 */
export function mutationOriginDenied(input: {
  method: string;
  pathname: string;
  origin: string | null;
  secFetchSite: string | null;
  requestHost: string;
  devAllowedOrigin: boolean;
}): string | null {
  if (SAFE_METHODS.has(input.method.toUpperCase())) return null;
  if (!input.pathname.startsWith('/api/')) return null;
  // Auth.js carries its own CSRF token; embed bootstrap is cross-origin by design
  // and gated by API key + origin allowlist; the subscription API uses a header secret.
  if (
    under(input.pathname, '/api/auth') ||
    input.pathname === '/api/embed/bootstrap' ||
    input.pathname === '/api/admin/subscription'
  ) {
    return null;
  }
  if (input.devAllowedOrigin) return null;
  if (input.secFetchSite === 'cross-site' || input.secFetchSite === 'same-site') return 'cross_site_request';
  if (input.origin) {
    let originHost: string;
    try {
      originHost = new URL(input.origin).host.toLowerCase();
    } catch {
      return 'invalid_origin';
    }
    if (originHost !== input.requestHost.trim().toLowerCase()) return 'origin_mismatch';
  }
  return null;
}
