import { getEnv } from '@/lib/env';

/**
 * Development-only relaxation of host and TLS checks for customer storage
 * (private hosts, plain HTTP, non-TLS PostgreSQL). env.ts refuses
 * OWN_STORAGE_DEV_INSECURE in production; this also re-checks NODE_ENV.
 */
export function devInsecure(): boolean {
  const env = getEnv();
  return env.OWN_STORAGE_DEV_INSECURE === 'true' && env.NODE_ENV !== 'production';
}
