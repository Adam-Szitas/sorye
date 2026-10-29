import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';

/** Only call after Hub has resolved the user/workspace from its server session. */
export function signRodrigoRequest(input: {
  userId: string; workspaceId: string; scope: string; method: string; path: string;
  body: string; keyId: string; privateKeyPem: string; now?: number;
}) {
  const key = createPrivateKey(input.privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Rodrigo signing key must be Ed25519');
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: input.keyId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'sorye-hub', aud: 'rodrigo', sub: input.userId, workspaceId: input.workspaceId,
    scope: input.scope, method: input.method, path: input.path,
    bodySha256: createHash('sha256').update(input.body).digest('hex'),
    iat: now, exp: now + 30, jti: randomUUID(),
  })).toString('base64url');
  const message = `${header}.${payload}`;
  return `${message}.${sign(null, Buffer.from(message), key).toString('base64url')}`;
}
