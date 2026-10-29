import 'server-only';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { RodrigoCapabilities } from '@sorye/types';
import { signRodrigoRequest } from './sign-request';

const status = z.enum(['not_implemented', 'not_configured', 'ready']);
const capabilitiesSchema = z.object({
  contractVersion: z.literal('1'), service: z.literal('rodrigo'), dataReady: z.boolean(),
  operations: z.array(z.string().max(64)).max(100),
  adapters: z.object({ postgresql: status, mongodb: status, redis: status, s3: status }),
});
export class RodrigoUnavailableError extends Error {
  constructor() { super('Rodrigo is unavailable or its contract is incompatible.'); }
}

export async function getRodrigoCapabilities(context: { userId: string; workspaceId: string }): Promise<RodrigoCapabilities> {
  const raw = process.env.RODRIGO_BASE_URL;
  const keyFile = process.env.RODRIGO_PRIVATE_KEY_FILE;
  const keyId = process.env.RODRIGO_KEY_ID;
  if (!raw || !keyFile || !keyId) throw new RodrigoUnavailableError();
  try {
    const origin = new URL(raw);
    const localHttp = process.env.NODE_ENV !== 'production' && origin.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
    if ((!localHttp && origin.protocol !== 'https:') || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
      throw new RodrigoUnavailableError();
    }
    const privateKeyPem = await readFile(keyFile, 'utf8');
    const path = '/v1/capabilities';
    const token = signRodrigoRequest({ ...context, scope: 'capabilities:read', method: 'GET', path, body: '', keyId, privateKeyPem });
    const response = await fetch(new URL(path, origin), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(3000), redirect: 'error', cache: 'no-store',
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new RodrigoUnavailableError(); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) throw new RodrigoUnavailableError();
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    return capabilitiesSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch { throw new RodrigoUnavailableError(); }
}
