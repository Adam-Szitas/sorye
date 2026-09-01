import { timingSafeEqual } from 'crypto';
import { getEnv } from '@/lib/env';
import type { WorkspaceEventName } from '@sorye/types';

const WORKSPACE_EVENT_NAME_SET = new Set<string>([
  'sorye.system.events_activated',
  'sorye.task.created',
  'sorye.task.updated',
  'sorye.task.moved',
  'sorye.calendar.saved',
  'sorye.notes.saved',
  'sorye.ocr.analyzed',
  'sorye.ocr.ready',
  'sorye.protocolio.generated',
  'sorye.studio.loaded',
  'sorye.studio.too_much',
  'sorye.messenger.posted',
  'sorye.test.ping',
]);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  '169.254.169.254',
]);

const IMAGE_DATA_URL_RE =
  /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

/** Max decoded-ish payload for base64 image data URLs (~4 MB raw). */
export const MAX_IMAGE_DATA_URL_LENGTH = 5_500_000;

export const MAX_HANDOFF_PAYLOAD_BYTES = 2_000_000;
export const MAX_MESSAGE_TEXT_LENGTH = 10_000;

export function isWorkspaceEventName(name: string): name is WorkspaceEventName {
  return WORKSPACE_EVENT_NAME_SET.has(name);
}

function pathnameOf(path: string): string {
  return path.split('?')[0] ?? path;
}

function isInternalAuthPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/api/auth' ||
    pathname.startsWith('/api/auth/')
  );
}

/**
 * Post-login destination: same-origin relative paths only.
 * Absolute URLs are accepted only when they match AUTH_URL's origin,
 * then reduced to path + search. Auth.js callback/login URLs are rejected
 * so a failed OAuth round-trip cannot loop back into /api/auth/*.
 */
export function safeRedirectPath(
  value: string | undefined,
  fallback = '/',
): string {
  if (!value) return fallback;

  let path = value;
  if (!value.startsWith('/')) {
    const origin = process.env.AUTH_URL;
    if (!origin) return fallback;
    try {
      const allowed = new URL(origin);
      const resolved = new URL(value);
      if (resolved.origin !== allowed.origin) return fallback;
      path = `${resolved.pathname}${resolved.search}`;
    } catch {
      return fallback;
    }
  }

  if (!path.startsWith('/') || path.startsWith('//')) return fallback;
  if (path.includes('\\') || path.includes('\0')) return fallback;
  if (isInternalAuthPath(pathnameOf(path))) return fallback;
  return path;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80')) return true;
  return false;
}

function isBlockedHost(hostname: string, allowLocalhost: boolean): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host)) {
    return !allowLocalhost || (host !== 'localhost' && host !== '127.0.0.1');
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return !allowLocalhost;
  }
  return false;
}

/**
 * Validates outbound webhook URLs to reduce SSRF risk.
 * Production: HTTPS only, no private/link-local hosts.
 * Development: HTTP allowed for localhost only.
 */
export function assertSafeWebhookUrl(raw: string): string {
  const urlText = raw.trim();
  if (!urlText) throw new Error('Webhook URL is required');

  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    throw new Error('Webhook URL is invalid');
  }

  const isDev = getEnv().NODE_ENV === 'development';
  const host = parsed.hostname;

  if (parsed.protocol === 'https:') {
    if (isBlockedHost(host, false)) {
      throw new Error('Webhook URL must not target private or metadata addresses');
    }
    return parsed.toString();
  }

  if (parsed.protocol === 'http:' && isDev) {
    const local =
      host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!local) {
      throw new Error('In development, HTTP webhooks are limited to localhost');
    }
    return parsed.toString();
  }

  throw new Error('Webhook URL must use HTTPS');
}

export function extractPostgresHost(databaseUrl: string): string | null {
  const match = databaseUrl.match(
    /^postgres(?:ql)?:\/\/(?:[^:@/]+(?::[^@/]*)?@)?([^:/]+)/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Validates a user-supplied Postgres URL before the server opens a connection.
 */
export function assertSafePostgresUrl(databaseUrl: string): void {
  const host = extractPostgresHost(databaseUrl);
  if (!host) throw new Error('Could not parse Postgres host from URL');

  const isDev = getEnv().NODE_ENV === 'development';
  const allowLocalhost = isDev;

  if (isBlockedHost(host, allowLocalhost)) {
    throw new Error(
      'Postgres host is not allowed (private, link-local, or metadata addresses are blocked)',
    );
  }
}

export function validateImageDataUrl(
  value: string,
): { ok: true; dataUrl: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!IMAGE_DATA_URL_RE.test(trimmed)) {
    return {
      ok: false,
      error: 'Image must be a base64 data URL (jpeg, png, webp, or gif)',
    };
  }
  if (trimmed.length > MAX_IMAGE_DATA_URL_LENGTH) {
    return { ok: false, error: 'Image is too large' };
  }
  return { ok: true, dataUrl: trimmed };
}

export function assertJsonPayloadSize(
  payload: unknown,
  maxBytes: number,
  label = 'Payload',
): void {
  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (size > maxBytes) {
    throw new Error(`${label} exceeds maximum size (${maxBytes} bytes)`);
  }
}
