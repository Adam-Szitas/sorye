import { NextRequest } from 'next/server';
import { classifyHost, hostConfig, hostnameOf } from './admin/hosts';

export class InvalidAuthOrigin extends Error {}

/**
 * Next standalone's request URL can contain the Docker bind address. Auth.js
 * beta.29 uses that URL for callbacks/errors, but headers for server actions.
 * Resolve both to the browser origin before Auth.js sees the request.
 * AUTH_TRUST_HOST is an operator assertion: Hub must be private and the ingress
 * must overwrite forwarding headers. Headers cannot prove a proxy's identity.
 */
export function publicRequestOrigin(headers: Headers, env: NodeJS.ProcessEnv = {
  // Literal reads also record these variables in the Edge middleware bundle.
  NODE_ENV: process.env.NODE_ENV,
  AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
  AUTH_URL: process.env.AUTH_URL,
  NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  SORYE_PUBLIC_HOST: process.env.SORYE_PUBLIC_HOST,
  SORYE_ADMIN_HOST: process.env.SORYE_ADMIN_HOST,
  SORYE_EXTRA_HOSTS: process.env.SORYE_EXTRA_HOSTS,
}): string {
  const production = env.NODE_ENV === 'production';
  if (production && (env.AUTH_URL || env.NEXTAUTH_URL)) {
    throw new InvalidAuthOrigin('Unset AUTH_URL and NEXTAUTH_URL for per-host authentication');
  }
  const trusted = env.AUTH_TRUST_HOST === 'true';
  const forwardedHost = headers.get('x-forwarded-host');
  const forwardedProto = headers.get('x-forwarded-proto');
  if (production && !trusted && (forwardedHost || forwardedProto)) {
    throw new InvalidAuthOrigin('Forwarded headers require AUTH_TRUST_HOST=true and private ingress');
  }
  const host = (trusted ? forwardedHost : null) ?? headers.get('host');
  const protocol = (trusted ? forwardedProto : null) ?? (production ? 'https' : 'http');
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host) || !['http', 'https'].includes(protocol)) {
    throw new InvalidAuthOrigin('Invalid public origin headers');
  }
  let origin: URL;
  try {
    origin = new URL(`${protocol}://${host}`);
  } catch {
    throw new InvalidAuthOrigin('Invalid public host');
  }
  const config = hostConfig(env);
  // Direct loopback requests are used by container healthchecks only.
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostnameOf(host)) &&
    headers.get('host') === host && (!forwardedHost || forwardedHost === host);
  if (production && !loopback && (
    protocol !== 'https' || origin.port ||
    classifyHost(origin.host, { forwarded: true }, config) === 'unknown'
  )) {
    throw new InvalidAuthOrigin('Unrecognized public HTTPS origin');
  }
  return origin.origin;
}

export function withPublicAuthOrigin(request: NextRequest): NextRequest {
  const url = new URL(request.url);
  const publicUrl = new URL(publicRequestOrigin(request.headers));
  url.protocol = publicUrl.protocol;
  url.hostname = publicUrl.hostname;
  url.port = publicUrl.port;
  // Preserve method, body, cookies and query without logging any of them.
  const normalized = new NextRequest(url, request);
  normalized.headers.set('host', publicUrl.host);
  normalized.headers.set('x-forwarded-host', publicUrl.host);
  normalized.headers.set('x-forwarded-proto', publicUrl.protocol.slice(0, -1));
  // Keep direct loopback healthchecks classified as direct, not public ingress.
  if (process.env.NODE_ENV === 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)) {
    normalized.headers.delete('x-forwarded-host');
  }
  return normalized;
}
