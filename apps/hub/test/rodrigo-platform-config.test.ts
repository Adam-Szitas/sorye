import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { SharedAiConfigV1 } from '@sorye/types';

process.env.AUTH_SECRET ??= 'test-only-auth-secret-0123456789';
process.env.ADMIN_SECRET ??= 'test-only-admin-secret';
process.env.AUTH_DEV_BYPASS ??= 'true';

const root = resolve(process.cwd(), '../..');
const value = (overrides: Partial<SharedAiConfigV1> = {}): SharedAiConfigV1 => ({
  provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3:8b', contextLength: 8192,
  maxOutputTokens: 1800, minFreeVramMiB: 1536, gpuIndex: 0, paused: false, ...overrides,
});

function decodeClaims(authorization: string | null): Record<string, unknown> {
  const token = (authorization ?? '').replace(/^Bearer /, '');
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
}

test('reviewed snapshot carries the platform contract and capability block', async () => {
  const reviewed = JSON.parse(await readFile(join(root, 'packages/types/contracts/rodrigo.openapi.json'), 'utf8'));
  const fixture = JSON.parse(await readFile(join(root, 'packages/types/contracts/rodrigo-capabilities.fixture.json'), 'utf8'));
  assert.equal(reviewed.info.version, '2.1.0');
  for (const path of ['/v2/platform/config/{namespace}', '/v2/platform/config/{namespace}/rollback', '/v2/platform/config/{namespace}/applied', '/v2/platform/audit', '/v2/platform/audit/{limit}/{cursor}']) {
    assert.ok(reviewed.paths[path], path);
  }
  assert.deepEqual(fixture.platform, { version: '1', provider: 'not_configured', namespaces: ['shared-ai'], maxAuditPageSize: 100 });
});

test('Hub validation refuses values Rodrigo would accept but this Hub cannot apply', async () => {
  const { validateSharedAiValue, propagationFor } = await import('../lib/admin/shared-ai');
  assert.equal(validateSharedAiValue(value()).ok, true);
  assert.equal(validateSharedAiValue(value({ baseUrl: 'http://169.254.169.254' })).ok, false);
  assert.equal(validateSharedAiValue(value({ baseUrl: 'http://user:pw@localhost:11434' })).ok, false);
  assert.equal(validateSharedAiValue(value({ contextLength: 9000 })).ok, false);
  assert.equal(validateSharedAiValue({ ...value(), extra: true }).ok, false);
  assert.equal(validateSharedAiValue(value({ model: '../etc' })).ok, false);
  const now = Date.parse('2026-11-10T12:00:00Z');
  const entry = (appliedRevision: number, status: 'applied' | 'failed', ageMs = 0) => ({
    consumer: 'ocr-worker' as const, instanceId: 'w1', appliedRevision, status, code: null, reportedAt: new Date(now - ageMs).toISOString(),
  });
  assert.equal(propagationFor(undefined, 3, now), 'unknown');
  assert.equal(propagationFor(entry(3, 'applied'), 3, now), 'applied');
  assert.equal(propagationFor(entry(2, 'applied'), 3, now), 'pending');
  assert.equal(propagationFor(entry(3, 'failed'), 3, now), 'failed');
  assert.equal(propagationFor(entry(3, 'applied', 10 * 60_000), 3, now), 'unknown');
});

test('platform client signs the reserved workspace and service subjects', { concurrency: false }, async (t) => {
  const keys = generateKeyPairSync('ed25519');
  const directory = await mkdtemp(join(tmpdir(), 'rodrigo-platform-'));
  const keyFile = join(directory, 'private.pem');
  await writeFile(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  const saved = { ...process.env };
  Object.assign(process.env, { RODRIGO_BASE_URL: 'http://127.0.0.1:43124', RODRIGO_KEY_ID: 'test', RODRIGO_PRIVATE_KEY_FILE: keyFile });
  t.after(async () => {
    for (const key of ['RODRIGO_BASE_URL', 'RODRIGO_KEY_ID', 'RODRIGO_PRIVATE_KEY_FILE']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
    await rm(directory, { recursive: true, force: true });
  });
  const seen: Array<{ claims: Record<string, unknown>; body: unknown }> = [];
  let reply: unknown = { contractVersion: '2', recorded: true };
  t.mock.method(globalThis, 'fetch', async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ claims: decodeClaims(new Headers(init?.headers).get('authorization')), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(reply);
  });
  const client = await import('../lib/rodrigo/platform-client');
  await client.reportPlatformConfigApplied('shared-ai', { consumer: 'ocr-worker', instanceId: 'w-1', appliedRevision: 4, status: 'applied' });
  assert.equal(seen[0].claims.sub, 'service:ocr-worker');
  assert.equal(seen[0].claims.workspaceId, 'rodrigo-platform');
  assert.equal(seen[0].claims.scope, 'platform:config:report');
  assert.deepEqual(seen[0].body, { consumer: 'ocr-worker', instanceId: 'w-1', appliedRevision: 4, status: 'applied' });

  reply = { contractVersion: '2', namespace: 'shared-ai', schemaVersion: 1, revision: 2, value: { ...value(), secret: 'x' }, updatedAt: null, updatedBy: null };
  const { RodrigoUnavailableError } = await import('../lib/rodrigo/service-client');
  await assert.rejects(() => client.getPlatformConfig('user:a', 'shared-ai'), RodrigoUnavailableError);
  assert.throws(() => client.listPlatformAudit('user:a', 101));
  assert.throws(() => client.listPlatformAudit('user:a', 10, 'zz'));
});

const postgres = process.env.RODRIGO_TEST_POSTGRES_URL;

test('real Rodrigo + PostgreSQL: CAS, idempotency, rollback, audit, propagation, restart and outage', {
  skip: !postgres, timeout: 120_000, concurrency: false,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sorye-platform-config-'));
  const keys = generateKeyPairSync('ed25519');
  const publicKeys = join(directory, 'keys.json');
  const privateKeyFile = join(directory, 'private.pem');
  const providersFile = join(directory, 'providers.json');
  await writeFile(publicKeys, JSON.stringify({ test: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }));
  await writeFile(privateKeyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  await writeFile(providersFile, JSON.stringify({ allow_insecure_local: true, postgresql: postgres }));
  const savedEnv = { ...process.env };
  process.env.SORYE_DATA_DIR = directory;
  let child: ChildProcess | null = null;
  const stop = async () => {
    if (!child) return;
    const closed = once(child, 'close').catch(() => undefined);
    child.kill();
    await closed;
    child = null;
  };
  const start = async () => {
    const env = { ...savedEnv };
    for (const key of Object.keys(env)) if (key.startsWith('RODRIGO_')) delete env[key];
    const binary = savedEnv.RODRIGO_TEST_BINARY ?? resolve(root, '../rodrigo/target/debug', process.platform === 'win32' ? 'rodrigo.exe' : 'rodrigo');
    const spawned = spawn(binary, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...env, RODRIGO_PUBLIC_KEYS_FILE: publicKeys, RODRIGO_PROVIDERS_FILE: providersFile,
      RODRIGO_LISTEN: '127.0.0.1:0', RODRIGO_METRICS_LISTEN: '127.0.0.1:0',
    } });
    child = spawned;
    spawned.stderr.resume();
    const origin = await new Promise<string>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('Rodrigo startup timed out')), 15000);
      spawned.once('error', (error) => { clearTimeout(timer); reject(error); });
      spawned.once('exit', () => { clearTimeout(timer); reject(new Error('Rodrigo exited during startup')); });
      let buffer = '';
      spawned.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        for (let index; (index = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          try { const record = JSON.parse(line); if (record.fields?.api) { clearTimeout(timer); resolveReady(`http://${record.fields.api}`); } } catch { /* not a log record */ }
        }
      });
    });
    Object.assign(process.env, { RODRIGO_BASE_URL: origin, RODRIGO_KEY_ID: 'test', RODRIGO_PRIVATE_KEY_FILE: privateKeyFile });
  };
  try {
    await start();
    const client = await import('../lib/rodrigo/platform-client');
    const { RodrigoResponseError, RodrigoUnavailableError, getRodrigoCapabilities } = await import('../lib/rodrigo/service-client');
    const { refreshPlatformConfig, startPlatformConfigWatcher, stopPlatformConfigWatcher } = await import('../lib/platform-config/watcher');
    const { getLlmControlSettings, getLlmControlSource } = await import('../lib/llm-control');
    const admin = `user:${randomUUID()}`;
    const other = `user:${randomUUID()}`;
    const code = async (promise: Promise<unknown>) => {
      try { await promise; return 'ok'; } catch (error) { return error instanceof RodrigoResponseError ? `${error.status}:${error.code}` : 'unavailable'; }
    };

    const capabilities = await getRodrigoCapabilities({ userId: admin, workspaceId: randomUUID() });
    assert.equal(capabilities.platform?.provider, 'ready');

    const before = await client.getPlatformConfig(admin, 'shared-ai');
    const base = before.revision;
    const first = { changeId: randomUUID(), expectedRevision: base, schemaVersion: 1 as const, value: value({ model: `qwen3:${base + 1}` }), correlationId: randomUUID() };
    const committed = await client.putPlatformConfig(admin, 'shared-ai', first);
    assert.equal(committed.status, 'committed');
    assert.equal(committed.revision, base + 1);

    const replay = await client.putPlatformConfig(admin, 'shared-ai', first);
    assert.equal(replay.status, 'duplicate');
    assert.equal(replay.revision, base + 1);
    assert.equal(replay.auditId, committed.auditId);

    assert.equal(await code(client.putPlatformConfig(other, 'shared-ai', first)), '409:idempotency_key_reused');
    assert.equal(await code(client.putPlatformConfig(admin, 'shared-ai', { ...first, value: value({ paused: true }) })), '409:idempotency_key_reused');
    assert.equal(await code(client.putPlatformConfig(admin, 'shared-ai', { ...first, changeId: randomUUID() })), '409:revision_conflict');
    assert.equal(await code(client.putPlatformConfig('service:hub', 'shared-ai', { ...first, changeId: randomUUID(), expectedRevision: base + 1 })), '403:platform_actor_forbidden');

    // Two administrators racing on the same expected revision: exactly one wins.
    const race = await Promise.allSettled([admin, other].map((actor) => client.putPlatformConfig(actor, 'shared-ai', {
      changeId: randomUUID(), expectedRevision: base + 1, schemaVersion: 1, value: value({ paused: actor === admin }), correlationId: randomUUID(),
    })));
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
    const loser = race.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal((loser.reason as InstanceType<typeof RodrigoResponseError>).code, 'revision_conflict');
    const afterRace = await client.getPlatformConfig(admin, 'shared-ai');
    assert.equal(afterRace.revision, base + 2);

    // Propagation into this process (the Hub consumer).
    const status = await startPlatformConfigWatcher('hub');
    assert.equal(status.appliedRevision, base + 2);
    assert.equal(getLlmControlSource().source, 'platform');
    assert.equal(getLlmControlSettings().paused, afterRace.value?.paused);
    const applied = await client.getPlatformConfigApplied(admin, 'shared-ai');
    const hub = applied.consumers.find((entry) => entry.consumer === 'hub' && entry.instanceId === status.instanceId);
    assert.equal(hub?.appliedRevision, base + 2);
    assert.equal(hub?.status, 'applied');

    // Rollback is a new revision with the older value; history is not rewritten.
    const rolled = await client.rollbackPlatformConfig(admin, 'shared-ai', { changeId: randomUUID(), expectedRevision: base + 2, targetRevision: base + 1, correlationId: randomUUID(), reason: 'verification rollback' });
    assert.equal(rolled.revision, base + 3);
    assert.deepEqual((await client.getPlatformConfig(admin, 'shared-ai')).value, first.value);
    assert.equal((await refreshPlatformConfig('hub')).appliedRevision, base + 3);
    assert.equal(getLlmControlSettings().model, first.value.model);

    // Hub-owned action audit and the trail.
    const correlationId = randomUUID();
    await client.appendPlatformAudit(admin, { eventId: randomUUID(), action: 'notice.create', targetType: 'notice', targetId: 'new', outcome: 'pending', correlationId, details: { audience: 'all', messageLength: 12 } });
    assert.equal(await code(client.appendPlatformAudit(admin, { eventId: randomUUID(), action: 'config.update', targetType: 'notice', targetId: 'x', outcome: 'pending', correlationId, details: {} })), '400:reserved_action');
    assert.equal(await code(client.appendPlatformAudit('service:hub', { eventId: randomUUID(), action: 'notice.create', targetType: 'notice', targetId: 'x', outcome: 'pending', correlationId, details: {} })), '403:platform_actor_forbidden');
    const page = await client.listPlatformAudit(admin, 20);
    assert.ok(page.events.some((event) => event.correlationId === correlationId && event.outcome === 'pending'));
    const configRow = page.events.find((event) => event.changeId === first.changeId);
    assert.equal(configRow?.outcome, 'committed');
    assert.equal(configRow?.revision, base + 1);
    assert.ok(page.events.some((event) => event.outcome === 'conflict'));
    assert.equal(JSON.stringify(page).includes('PRIVATE KEY'), false);
    if (page.nextCursor) {
      const next = await client.listPlatformAudit(admin, 20, page.nextCursor);
      const ids = new Set(page.events.map((event) => event.auditId));
      assert.equal(next.events.some((event) => ids.has(event.auditId)), false);
    }

    // Restart: durable state survives.
    await stop();
    await start();
    assert.equal((await client.getPlatformConfig(admin, 'shared-ai')).revision, base + 3);

    // Outage: writes report unknown outcome, the consumer keeps its last applied revision.
    await stop();
    await assert.rejects(() => client.putPlatformConfig(admin, 'shared-ai', { ...first, changeId: randomUUID(), expectedRevision: base + 3 }), RodrigoUnavailableError);
    const during = await refreshPlatformConfig('hub');
    assert.equal(during.lastError, 'rodrigo_unavailable');
    assert.equal(during.appliedRevision, base + 3);
    assert.equal(getLlmControlSettings().model, first.value.model);
    const cache = JSON.parse(await readFile(join(directory, 'platform-config', 'hub-shared-ai.json'), 'utf8'));
    assert.equal(cache.revision, base + 3);
    stopPlatformConfigWatcher();
  } finally {
    await stop();
    for (const key of ['RODRIGO_BASE_URL', 'RODRIGO_KEY_ID', 'RODRIGO_PRIVATE_KEY_FILE', 'SORYE_DATA_DIR']) {
      if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
