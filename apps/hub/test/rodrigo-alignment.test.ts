import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { docker, harnessConfigured, startRodrigo, type Harness } from './helpers/rodrigo-harness';

process.env.AUTH_SECRET ??= 'test-only-auth-secret-0123456789';

/**
 * Alignment slice 0 against the real Rodrigo binary, PostgreSQL and S3 (opt in, see
 * helpers/rodrigo-harness.ts). Failure injection stops containers of the disposable
 * `rodrigo-align` stack only (RODRIGO_TEST_S3_CONTAINER / RODRIGO_TEST_POSTGRES_CONTAINER).
 */
const root = resolve(process.cwd(), '../..');
const MiB = 1024 * 1024;
const ctx = (workspaceId = 'align-ws-a', userId = 'align-user') => ({ userId, workspaceId });
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

async function* chunks(total: number, chunk = 256 * 1024, seed = 7): AsyncIterable<Uint8Array> {
  const block = Buffer.alloc(chunk);
  for (let i = 0; i < chunk; i += 1) block[i] = (i * 31 + seed) & 0xff;
  for (let sent = 0; sent < total; sent += chunk) yield block.subarray(0, Math.min(chunk, total - sent));
}
async function digestOf(total: number, chunk = 256 * 1024, seed = 7) {
  const hash = createHash('sha256');
  for await (const value of chunks(total, chunk, seed)) hash.update(value);
  return hash.digest('hex');
}
async function drain(response: Response) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const value of response.body as unknown as AsyncIterable<Uint8Array>) { hash.update(value); size += value.length; }
  return { size, sha256: hash.digest('hex') };
}
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

test('reviewed snapshot and fixture carry the alignment contract', async () => {
  const reviewed = JSON.parse(await readFile(join(root, 'packages/types/contracts/rodrigo.openapi.json'), 'utf8'));
  const fixture = JSON.parse(await readFile(join(root, 'packages/types/contracts/rodrigo-capabilities.fixture.json'), 'utf8'));
  assert.ok(Number(reviewed.info.version.split('.')[1]) >= 2, reviewed.info.version);
  for (const path of ['/v2/objects/uploads', '/v2/objects/uploads/{uploadId}/parts/{partNumber}', '/v2/objects/uploads/{uploadId}/complete',
    '/v2/objects/{objectId}', '/v2/service-tokens', '/v2/service-tokens/keys', '/v2/service/changes/head', '/v2/service/changes/{after}']) {
    assert.ok(reviewed.paths[path], path);
  }
  assert.equal(fixture.alignment.version, '1');
  assert.equal(fixture.alignment.objects.partBytes, 8 * MiB);
});

describe('alignment plumbing against real Rodrigo', { skip: !harnessConfigured, concurrency: false }, () => {
  let rodrigo: Harness;
  before(async () => { rodrigo = await startRodrigo(); });
  after(async () => {
    const { stopRodrigoChangeStream } = await import('../lib/rodrigo/changes');
    stopRodrigoChangeStream();
    await rodrigo?.stop();
  });

  test('capabilities report plumbing ready', async () => {
    const { rodrigoServiceRequest } = await import('../lib/rodrigo/service-client');
    const { z } = await import('zod');
    const caps = await rodrigoServiceRequest(ctx(), '/v1/capabilities', 'capabilities:read', z.object({ alignment: z.any(), operations: z.array(z.string()) }).passthrough());
    assert.equal(caps.alignment.slices.plumbing, 'ready');
    for (const op of ['objects:read', 'objects:write', 'service-tokens:issue', 'changes:read']) assert.ok(caps.operations.includes(op), op);
  });

  test('small object: create-only, read, range, meta, delete, id never reused', async () => {
    const { uploadObject, openObject, objectMeta, deleteObject, createObjectUpload } = await import('../lib/rodrigo/objects-client');
    const objectId = randomUUID();
    const body = Buffer.from('hello alignment');
    const meta = await uploadObject(ctx(), { objectId, purpose: 'tasks', size: body.length, sha256: sha256(body), contentType: 'text/plain' }, (async function* () { yield body; })());
    assert.equal(meta.size, body.length);
    assert.equal(meta.sha256, sha256(body));
    const read = await openObject(ctx(), 'tasks', objectId);
    assert.equal(read.headers.get('x-object-sha256'), sha256(body));
    assert.equal(Buffer.from(await read.arrayBuffer()).toString(), 'hello alignment');
    const ranged = await openObject(ctx(), 'tasks', objectId, 'bytes=6-14');
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), 'alignment');
    assert.equal((await objectMeta(ctx(), 'tasks', objectId)).contentType, 'text/plain');
    await assert.rejects(createObjectUpload(ctx(), { objectId, purpose: 'tasks', size: body.length, sha256: sha256(body), contentType: 'text/plain' }), { code: 'object_exists' });
    // Other workspace and other app scope cannot see it.
    await assert.rejects(openObject(ctx('align-ws-b'), 'tasks', objectId), { status: 404 });
    await assert.rejects(openObject(ctx(), 'ocr', objectId), { status: 403 });
    await deleteObject(ctx(), 'tasks', objectId);
    await assert.rejects(openObject(ctx(), 'tasks', objectId), { status: 404 });
    await assert.rejects(createObjectUpload(ctx(), { objectId, purpose: 'tasks', size: body.length, sha256: sha256(body), contentType: 'text/plain' }), { code: 'object_id_reused' });
  });

  test('damaged bytes are rejected: whole-object checksum and per-part checksum', async () => {
    const { uploadObject, createObjectUpload, ObjectUploadError } = await import('../lib/rodrigo/objects-client');
    const { signedFetch } = await import('../lib/rodrigo/transport');
    const body = Buffer.from('payload');
    await assert.rejects(
      uploadObject(ctx(), { objectId: randomUUID(), purpose: 'tasks', size: body.length, sha256: sha256('other'), contentType: 'text/plain' }, (async function* () { yield body; })()),
      (error: unknown) => error instanceof ObjectUploadError && error.code === 'checksum_mismatch',
    );
    // A part whose bytes differ from the signed part digest is refused by Rodrigo.
    const session = await createObjectUpload(ctx(), { objectId: randomUUID(), purpose: 'tasks', size: body.length, sha256: sha256(body), contentType: 'text/plain' });
    const response = await signedFetch({
      context: ctx(), method: 'PUT', path: `/v2/objects/uploads/${session.uploadId}/parts/1`, scope: 'objects:write', appScopes: ['tasks'],
      body: [Buffer.from('paylOad')], bodySha256: sha256(body),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'checksum_mismatch');
    const complete = await signedFetch({ context: ctx(), method: 'POST', path: `/v2/objects/uploads/${session.uploadId}/complete`, scope: 'objects:write', appScopes: ['tasks'], body: '' });
    assert.equal(complete.status, 409, 'missing part blocks completion');
    await complete.body?.cancel();
  });

  test('64 MiB streamed upload and download: bounded Hub memory, measured latency', async () => {
    const { uploadObject, openObject } = await import('../lib/rodrigo/objects-client');
    const size = 64 * MiB;
    const digest = await digestOf(size);
    global.gc?.();
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    const baseBuffers = process.memoryUsage().arrayBuffers;
    let peakBuffers = baseBuffers;
    const sampler = setInterval(() => { const m = process.memoryUsage(); peak = Math.max(peak, m.rss); peakBuffers = Math.max(peakBuffers, m.arrayBuffers); }, 10);
    const objectId = randomUUID();
    const started = performance.now();
    const meta = await uploadObject(ctx(), { objectId, purpose: 'tasks', size, sha256: digest, contentType: 'application/octet-stream' }, chunks(size));
    const uploadMs = performance.now() - started;
    const readStarted = performance.now();
    const read = await drain(await openObject(ctx(), 'tasks', objectId));
    const downloadMs = performance.now() - readStarted;
    clearInterval(sampler);
    assert.equal(meta.size, size);
    assert.deepEqual(read, { size, sha256: digest });
    const growthMiB = (peak - baseline) / MiB;
    const buffersMiB = (peakBuffers - baseBuffers) / MiB;
    console.log(`[measure] 64 MiB upload ${uploadMs.toFixed(0)} ms (${(64 / (uploadMs / 1000)).toFixed(1)} MiB/s), download ${downloadMs.toFixed(0)} ms, Hub RSS growth ${growthMiB.toFixed(1)} MiB, peak Buffer growth ${buffersMiB.toFixed(1)} MiB`);
    // Whole-file buffering would add at least the file size; parts and GC lag stay well below it.
    assert.ok(buffersMiB < 64, `Hub must not buffer whole files (Buffers grew ${buffersMiB.toFixed(1)} MiB)`);
  });

  test('resume skips stored parts and survives a Rodrigo restart', async () => {
    const { uploadObject, createObjectUpload } = await import('../lib/rodrigo/objects-client');
    const { signedFetch } = await import('../lib/rodrigo/transport');
    const size = 8 * MiB + 1234;
    const digest = await digestOf(size);
    const objectId = randomUUID();
    const meta = { objectId, purpose: 'tasks' as const, size, sha256: digest, contentType: 'application/octet-stream' };
    const session = await createObjectUpload(ctx(), meta);
    const first: Buffer[] = [];
    let taken = 0;
    for await (const value of chunks(size)) {
      if (taken >= 8 * MiB) break;
      const part = Buffer.from(value.subarray(0, Math.min(value.length, 8 * MiB - taken)));
      first.push(part); taken += part.length;
    }
    const part = await signedFetch({ context: ctx(), method: 'PUT', path: `/v2/objects/uploads/${session.uploadId}/parts/1`, scope: 'objects:write', appScopes: ['tasks'], body: first, bodySha256: sha256(Buffer.concat(first)), timeoutMs: 30000 });
    assert.equal(part.status, 200);
    await part.body?.cancel();
    await rodrigo.restart();
    const resumed = await createObjectUpload(ctx(), meta);
    assert.equal(resumed.uploadId, session.uploadId);
    assert.deepEqual(resumed.uploadedParts.map((p) => p.partNumber), [1]);
    let partPuts = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/parts/')) partPuts += 1;
      return realFetch(url, init);
    }) as typeof fetch;
    try {
      const done = await uploadObject(ctx(), meta, chunks(size));
      assert.equal(done.sha256, digest);
    } finally { globalThis.fetch = realFetch; }
    assert.equal(partPuts, 1, 'only the missing part is sent');
  });

  test('concurrent part uploads: p50/p95 and admission', async () => {
    const { uploadObject } = await import('../lib/rodrigo/objects-client');
    const timings: number[] = [];
    const size = 2 * MiB;
    const digest = await digestOf(size);
    await Promise.all(Array.from({ length: 16 }, async () => {
      const started = performance.now();
      await uploadObject(ctx(), { objectId: randomUUID(), purpose: 'tasks', size, sha256: digest, contentType: 'application/octet-stream' }, chunks(size));
      timings.push(performance.now() - started);
    }));
    console.log(`[measure] 16 concurrent 2 MiB uploads p50 ${percentile(timings, 50).toFixed(0)} ms p95 ${percentile(timings, 95).toFixed(0)} ms`);
  });

  test('service tokens are scoped, short-lived and verifiable with the published key', async () => {
    const { issueServiceToken } = await import('../lib/rodrigo/service-tokens');
    const issued = await issueServiceToken(ctx(), { service: 'ocr', operation: 'ocr.recognize', appId: 'ocr', ttlSeconds: 120 });
    assert.equal(issued.audience, 'sorye-ocr');
    const keys = await (await fetch(`${rodrigo.origin}/v2/service-tokens/keys`)).json();
    assert.equal(keys.keys[0].publicKeyPem, rodrigo.serviceTokenPublicKeyPem);
    const [header, payload, signature] = issued.token.split('.');
    assert.ok(verify(null, Buffer.from(`${header}.${payload}`), createPublicKey(keys.keys[0].publicKeyPem), Buffer.from(signature, 'base64url')));
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    assert.equal(claims.workspaceId, 'align-ws-a');
    assert.equal(claims.sub, 'align-user');
    assert.equal(claims.operation, 'ocr.recognize');
    assert.ok(claims.exp - claims.iat <= 300);
    await assert.rejects(issueServiceToken(ctx(), { service: 'protocolio', operation: 'render', appId: 'ocr', ttlSeconds: 60 }), { status: 403 });
  });

  test('change stream delivers commits to Hub and invalidates the read cache', async () => {
    const { ensureRodrigoChangeStream, onRodrigoChange, rodrigoChangesHealthy } = await import('../lib/rodrigo/changes');
    ensureRodrigoChangeStream();
    const { cachedRead, readCacheStats } = await import('../lib/rodrigo/read-cache');
    const { uploadObject } = await import('../lib/rodrigo/objects-client');
    const seen: string[] = [];
    const off = onRodrigoChange((change) => { if (change.appId === 'objects') seen.push(change.resourceId); });
    for (let i = 0; i < 100 && !rodrigoChangesHealthy(); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(rodrigoChangesHealthy(), 'stream connected');
    const scope = { workspaceId: 'align-ws-a', appId: 'objects', resourceType: 'object' };
    let loads = 0;
    const load = async () => { loads += 1; return { n: loads }; };
    assert.deepEqual(await cachedRead(scope, 'list', load), { n: 1 });
    assert.deepEqual(await cachedRead(scope, 'list', load), { n: 1 }, 'served from cache');
    const objectId = randomUUID();
    const body = Buffer.from('change me');
    const started = performance.now();
    await uploadObject(ctx(), { objectId, purpose: 'tasks', size: body.length, sha256: sha256(body), contentType: 'text/plain' }, (async function* () { yield body; })());
    for (let i = 0; i < 100 && !seen.includes(objectId); i += 1) await new Promise((r) => setTimeout(r, 20));
    const lagMs = performance.now() - started;
    off();
    assert.ok(seen.includes(objectId), 'change delivered');
    assert.deepEqual(await cachedRead(scope, 'list', load), { n: 2 }, 'invalidated by the change');
    console.log(`[measure] commit → Hub change delivery ≤ ${lagMs.toFixed(0)} ms; cache ${JSON.stringify(readCacheStats())}`);
  });

  test('storage down: uploads fail closed with 503 and nothing is acknowledged', { skip: !process.env.RODRIGO_TEST_S3_CONTAINER }, async () => {
    const { uploadObject } = await import('../lib/rodrigo/objects-client');
    const { RodrigoResponseError } = await import('../lib/rodrigo/service-client');
    await docker('stop', process.env.RODRIGO_TEST_S3_CONTAINER!);
    try {
      const body = Buffer.from('no storage');
      await assert.rejects(
        uploadObject(ctx(), { objectId: randomUUID(), purpose: 'tasks', size: body.length, sha256: sha256(body), contentType: 'text/plain' }, (async function* () { yield body; })()),
        (error: unknown) => error instanceof RodrigoResponseError && error.status === 503,
      );
    } finally {
      await docker('start', process.env.RODRIGO_TEST_S3_CONTAINER!);
    }
    for (let i = 0; i < 60; i += 1) {
      const ready = await fetch(`${rodrigo.origin}/health/ready`).then((r) => r.ok).catch(() => false);
      if (ready) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  test('database down: object routes fail closed and recover', { skip: !process.env.RODRIGO_TEST_POSTGRES_CONTAINER }, async () => {
    const { objectMeta } = await import('../lib/rodrigo/objects-client');
    const { RodrigoResponseError, RodrigoUnavailableError } = await import('../lib/rodrigo/service-client');
    await docker('stop', process.env.RODRIGO_TEST_POSTGRES_CONTAINER!);
    try {
      await assert.rejects(objectMeta(ctx(), 'tasks', randomUUID()),
        (error: unknown) => (error instanceof RodrigoResponseError && error.status === 503) || error instanceof RodrigoUnavailableError);
    } finally {
      await docker('start', process.env.RODRIGO_TEST_POSTGRES_CONTAINER!);
    }
    for (let i = 0; i < 60; i += 1) {
      const ok = await objectMeta(ctx(), 'tasks', randomUUID()).then(() => true, (e) => e instanceof RodrigoResponseError && e.status === 404);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await assert.rejects(objectMeta(ctx(), 'tasks', randomUUID()), { status: 404 });
  });
});
