import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { test } from 'node:test';
import { signRodrigoRequest } from '../lib/rodrigo/sign-request';
import type { RodrigoCapabilities } from '@sorye/types';

test('Next.js signer interoperates with the real Rodrigo HTTP server', { timeout: 30000 }, async (t) => {
  const root = resolve(process.cwd(), '../..');
  const keys = generateKeyPairSync('ed25519');
  const privateKeyPem = keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();
  const publicKey = keys.publicKey.export({type:'spki',format:'pem'}).toString();
  const directory = await mkdtemp(join(tmpdir(), 'rodrigo-contract-'));
  const publicKeys = join(directory, 'keys.json');
  await writeFile(publicKeys, JSON.stringify({ 'test-only': publicKey }));
  const binary = process.env.RODRIGO_TEST_BINARY ?? join(root, '../rodrigo/target/debug', process.platform === 'win32' ? 'rodrigo.exe' : 'rodrigo');
  const child = spawn(binary, [], {
    windowsHide: true,
    env: { ...process.env, RODRIGO_PUBLIC_KEYS_FILE: publicKeys, RODRIGO_LISTEN: '127.0.0.1:0', RODRIGO_METRICS_LISTEN: '127.0.0.1:0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'close');
  child.stderr.resume();
  try {
    const origin = await new Promise<string>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('Rodrigo did not become ready')), 10000);
      let buffer = '';
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Rodrigo exited before readiness')); });
      child.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const parsed = JSON.parse(line);
            if (parsed.fields?.api) { clearTimeout(timer); resolveReady(`http://${parsed.fields.api}`); }
          } catch { /* non-JSON startup lines are not readiness */ }
        }
      });
    });
    const call = async (path: string, scope: string, body = '', method = 'GET', signedBody = body, now?: number) => {
      const token = signRodrigoRequest({ userId: 'contract-user', workspaceId: 'contract-workspace', scope, method, path, body: signedBody, keyId: 'test-only', privateKeyPem, now });
      return fetch(`${origin}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body }), signal: AbortSignal.timeout(5000) });
    };
    await t.test('capabilities match the shared fixture and expose no active adapters', async () => {
      const response = await call('/v1/capabilities', 'capabilities:read');
      assert.equal(response.status, 200);
      const body = await response.json() as RodrigoCapabilities;
      const fixture = JSON.parse(await readFile(join(root, 'packages/types/contracts/rodrigo-capabilities.fixture.json'), 'utf8'));
      assert.deepEqual(body, fixture);
      assert.ok(response.headers.get('x-request-id'));
    });
    await t.test('missing token is rejected', async () => {
      const response = await fetch(`${origin}/v1/capabilities`);
      assert.equal(response.status, 401); await response.body?.cancel();
    });
    await t.test('scope and expiry are enforced across languages', async () => {
      const scope = await call('/v1/capabilities', 'documents:read');
      assert.equal(scope.status, 403); await scope.body?.cancel();
      const expired = await call('/v1/capabilities', 'capabilities:read', '', 'GET', '', Math.floor(Date.now()/1000) - 60);
      assert.equal(expired.status, 401); await expired.body?.cancel();
    });
    await t.test('signed write is not falsely acknowledged without a database', async () => {
      const response = await call('/v1/documents/tasks', 'documents:write', JSON.stringify({expectedRevision:0,payload:{board:[]}}), 'PUT');
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'adapter_not_configured');
    });
    await t.test('payload substitution and workspace injection are rejected', async () => {
      const substitution = await call('/v1/documents/tasks', 'documents:write', '{}', 'PUT', 'signed different payload');
      assert.equal(substitution.status, 401); await substitution.body?.cancel();
      const injection = await call('/v1/documents/tasks', 'documents:write', JSON.stringify({expectedRevision:0,payload:{},workspaceId:'victim'}), 'PUT');
      assert.equal(injection.status, 400); await injection.body?.cancel();
    });
    await t.test('Unicode body bytes have the same digest in Node and Rust', async () => {
      const body = JSON.stringify({expectedRevision:0,payload:{text:'\u00e1\u03bb\ud83d\udcc4'}});
      const response = await call('/v1/documents/notes', 'documents:write', body, 'PUT');
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'adapter_not_configured');
    });
  } finally {
    child.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});
