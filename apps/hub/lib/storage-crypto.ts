import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getEnv } from '@/lib/env';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function key() {
  return createHash('sha256').update(getEnv().AUTH_SECRET).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted payload');
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64!, 'base64');
  const tag = Buffer.from(tagB64!, 'base64');
  const data = Buffer.from(dataB64!, 'base64');
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
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
