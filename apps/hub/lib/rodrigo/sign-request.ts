import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';

/**
 * Only call after Hub has resolved the user/workspace from its server session.
 * `bodySha256` replaces the body digest for streamed object parts: the claim is then the
 * part's SHA-256, which Rodrigo verifies while it receives the bytes.
 */
export function signRodrigoRequest(input: {
  userId: string; workspaceId: string; scope: string; method: string; path: string;
  body: string | Uint8Array; keyId: string; privateKeyPem: string; now?: number;
  appScopes?: string[]; actionScopes?: string[]; bodySha256?: string;
}) {
  const key = createPrivateKey(input.privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Rodrigo signing key must be Ed25519');
  if (input.bodySha256 !== undefined && !/^[0-9a-f]{64}$/.test(input.bodySha256)) throw new Error('bodySha256 must be lower-case hex');
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: input.keyId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'sorye-hub', aud: 'rodrigo', sub: input.userId, workspaceId: input.workspaceId,
    scope: input.scope, method: input.method, path: input.path,
    ...(input.appScopes ? { appScopes: input.appScopes } : {}),
    ...(input.actionScopes ? { actionScopes: input.actionScopes } : {}),
    bodySha256: input.bodySha256 ?? createHash('sha256').update(input.body).digest('hex'),
    iat: now, exp: now + 30, jti: randomUUID(),
  })).toString('base64url');
  const message = `${header}.${payload}`;
  return `${message}.${sign(null, Buffer.from(message), key).toString('base64url')}`;
}
