import { createHmac, timingSafeEqual } from 'crypto';
import { getEnv } from '@/lib/env';

export const EMBED_COOKIE = 'sorye_embed';
export const EMBED_TOKEN_TTL_SEC = 60 * 60 * 12; // 12 hours

export interface EmbedTokenPayload {
  /** Widget id */
  wid: string;
  /** Workspace id */
  ws: string;
  /** Acting user (workspace owner / creator) */
  uid: string;
  /** Apps allowed for this session */
  apps: string[];
  /** Allowed parent origins */
  origins: string[];
  /** App slug locked for this embed */
  app: string;
  /** Expiry unix seconds */
  exp: number;
}

function secret() {
  return getEnv().AUTH_SECRET;
}

function b64url(input: Buffer | string) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(input: string) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

export function signEmbedToken(payload: EmbedTokenPayload): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret()).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

export function verifyEmbedToken(token: string): EmbedTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  const expected = createHmac('sha256', secret()).update(body).digest();
  let actual: Buffer;
  try {
    actual = fromB64url(sig);
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as EmbedTokenPayload;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    if (!payload.wid || !payload.ws || !payload.uid || !payload.app) return null;
    if (!Array.isArray(payload.apps) || !Array.isArray(payload.origins)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function hashEmbedKey(apiKey: string): string {
  return createHmac('sha256', secret()).update(apiKey).digest('hex');
}
