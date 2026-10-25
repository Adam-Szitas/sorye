import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getEnv } from '@/lib/env';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function deriveKey(secret: string) {
  return createHash('sha256').update(secret).digest();
}

function key() {
  return deriveKey(getEnv().AUTH_SECRET);
}

/** Optional override for Mail IMAP/SMTP secrets; otherwise AUTH_SECRET. */
function mailKey() {
  const override = process.env.MAIL_SECRET_KEY?.trim();
  if (override && override.length < 16) {
    throw new Error('MAIL_SECRET_KEY must be at least 16 characters');
  }
  return deriveKey(override || getEnv().AUTH_SECRET);
}

function encryptWithKey(plain: string, secret: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, secret, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

function decryptWithKey(payload: string, secret: Buffer): string {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted payload');
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64!, 'base64');
  const tag = Buffer.from(tagB64!, 'base64');
  const data = Buffer.from(dataB64!, 'base64');
  const decipher = createDecipheriv(ALGO, secret, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}

export function encryptSecret(plain: string): string {
  return encryptWithKey(plain, key());
}

export function decryptSecret(payload: string): string {
  return decryptWithKey(payload, key());
}

export function encryptMailSecret(plain: string): string {
  return encryptWithKey(plain, mailKey());
}

export function decryptMailSecret(payload: string): string {
  return decryptWithKey(payload, mailKey());
}

export function hintsFromDatabaseUrl(url: string): {
  hostHint: string;
  databaseHint: string;
} {
  try {
    const parsed = new URL(url);
    const hostHint = parsed.hostname || 'postgres';
    const databaseHint = parsed.pathname.replace(/^\//, '') || 'postgres';
    return { hostHint, databaseHint };
  } catch {
    return { hostHint: 'postgres', databaseHint: 'database' };
  }
}
