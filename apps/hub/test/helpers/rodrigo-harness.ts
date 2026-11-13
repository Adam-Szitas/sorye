import { generateKeyPairSync } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Starts the real Rodrigo binary against disposable PostgreSQL and S3 for alignment tests.
 * Opt in with RODRIGO_TEST_POSTGRES_URL and RODRIGO_TEST_S3_ENDPOINT (bucket rodrigo-test,
 * test-only credentials, sentinel `rodrigo-health`). Never point these at real data.
 */
export const harnessConfigured = Boolean(process.env.RODRIGO_TEST_POSTGRES_URL && process.env.RODRIGO_TEST_S3_ENDPOINT);

export interface Harness {
  origin: string;
  directory: string;
  serviceTokenPublicKeyPem: string;
  restart(): Promise<void>;
  stop(): Promise<void>;
}

function binary() {
  return process.env.RODRIGO_TEST_BINARY
    ?? resolve(process.cwd(), '../../../rodrigo/target/debug', process.platform === 'win32' ? 'rodrigo.exe' : 'rodrigo');
}

export async function startRodrigo(options: { extraProviders?: Record<string, unknown> } = {}): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), 'rodrigo-align-'));
  const hubKeys = generateKeyPairSync('ed25519');
  const serviceKeys = generateKeyPairSync('ed25519');
  const privateKeyFile = join(directory, 'private.pem');
  await writeFile(privateKeyFile, hubKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  await writeFile(join(directory, 'public.json'), JSON.stringify({ 'test-only': hubKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }));
  const serviceTokenPublicKeyPem = serviceKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  await writeFile(join(directory, 'service-tokens.json'), JSON.stringify({
    keyId: 'svc-test', privateKeyPem: serviceKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), publicKeyPem: serviceTokenPublicKeyPem,
  }));
  await writeFile(join(directory, 'providers.json'), JSON.stringify({
    allow_insecure_local: true,
    postgresql: process.env.RODRIGO_TEST_POSTGRES_URL,
    storage: { local: { endpoint: process.env.RODRIGO_TEST_S3_ENDPOINT, region: 'us-east-1', bucket: 'rodrigo-test', access_key_id: 'test-access', secret_access_key: 'test-secret-only' } },
    objects: 'local',
    ...options.extraProviders,
  }));
  let child: ChildProcess | undefined;
  let port = 0;
  const start = async () => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('RODRIGO_')) delete env[key];
    child = spawn(binary(), [], {
      windowsHide: true,
      env: {
        ...env, RODRIGO_PUBLIC_KEYS_FILE: join(directory, 'public.json'), RODRIGO_PROVIDERS_FILE: join(directory, 'providers.json'),
        RODRIGO_SERVICE_TOKEN_KEYS_FILE: join(directory, 'service-tokens.json'),
        RODRIGO_LISTEN: `127.0.0.1:${port}`, RODRIGO_METRICS_LISTEN: '127.0.0.1:0', RODRIGO_MAX_IN_FLIGHT: '64',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stderr!.resume();
    const origin = await new Promise<string>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('Rodrigo did not become ready')), 20000);
      let buffer = '';
      child!.once('error', (error) => { clearTimeout(timer); reject(error); });
      child!.once('exit', () => { clearTimeout(timer); reject(new Error('Rodrigo exited before readiness')); });
      child!.stdout!.on('data', (data: Buffer) => {
        buffer += data.toString();
        for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const parsed = JSON.parse(line);
            if (parsed.fields?.api) { clearTimeout(timer); resolveReady(`http://${parsed.fields.api}`); }
          } catch { /* not readiness */ }
        }
      });
    });
    port = Number(new URL(origin).port);
    process.env.RODRIGO_BASE_URL = `${origin}/`;
    process.env.RODRIGO_PRIVATE_KEY_FILE = privateKeyFile;
    process.env.RODRIGO_KEY_ID = 'test-only';
    return origin;
  };
  const stopChild = async () => {
    if (!child || child.exitCode !== null) return;
    const closed = once(child, 'close');
    child.kill();
    await closed;
  };
  const origin = await start();
  return {
    origin, directory, serviceTokenPublicKeyPem,
    restart: async () => { await stopChild(); await start(); },
    stop: async () => { await stopChild(); await rm(directory, { recursive: true, force: true }); },
  };
}

/** Runs `docker <args>` for failure injection against the disposable stack. */
export async function docker(...args: string[]): Promise<void> {
  const child = spawn('docker', args, { stdio: 'ignore', windowsHide: true });
  const [code] = await once(child, 'close');
  if (code !== 0) throw new Error(`docker ${args.join(' ')} failed (${code})`);
}
