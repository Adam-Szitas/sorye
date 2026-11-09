import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { RodrigoAction } from '@sorye/types';
import { RodrigoResponseError, RodrigoUnavailableError, submitRodrigoActionBatch } from '../lib/rodrigo/service-client';

const actionId = 'fe16c46d-a8ed-4e3d-8a12-c11906ccf72a';
const action = (overrides: Partial<RodrigoAction> = {}): RodrigoAction => ({
  actionId, appId: 'notes', resourceType: 'note', operation: 'create', resourceId: 'note-1', payloadVersion: 1,
  payload: { id: 'note-1', title: 'Title', body: 'Body', updatedAt: '2026-11-09T12:00:00.000Z' },
  occurredAt: '2026-11-09T12:00:00.000Z', ...overrides,
});
const committed = (id = actionId) => ({ actionId: id, status: 'committed', commitId: 'bb5e6017-5848-4bea-b331-555f8bc56d7a', revision: 1 });

test('reviewed Sorye OpenAPI snapshot stays byte-equivalent to Rodrigo authority for v2', async () => {
  const root = resolve(process.cwd(), '../..');
  const authoritative = JSON.parse(await readFile(resolve(root, '../rodrigo/contracts/rodrigo.openapi.json'), 'utf8'));
  const reviewed = JSON.parse(await readFile(join(root, 'packages/types/contracts/rodrigo.openapi.json'), 'utf8'));
  assert.deepEqual(reviewed, authoritative);
  assert.deepEqual(authoritative.paths['/v2/actions/batch'].post.responses['200'].content['application/json'].schema, { $ref: '#/components/schemas/ActionBatchResult' });
  assert.deepEqual(authoritative.components.schemas.Action.properties.actionId, { type: 'string', format: 'uuid' });
  assert.deepEqual(authoritative.components.schemas.TaskBoardPayload.required, ['statuses', 'tasks']);
  assert.deepEqual(authoritative.components.schemas.ActionResult.properties.status.enum, ['committed', 'duplicate', 'conflict', 'rejected']);
});

test('Rodrigo action client rejects invalid requests before signing or sending', { concurrency: false }, async (t) => {
  const keys = generateKeyPairSync('ed25519');
  const directory = await mkdtemp(join(tmpdir(), 'rodrigo-actions-'));
  const keyFile = join(directory, 'private.pem');
  await writeFile(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  const old = { url: process.env.RODRIGO_BASE_URL, key: process.env.RODRIGO_KEY_ID, file: process.env.RODRIGO_PRIVATE_KEY_FILE };
  process.env.RODRIGO_BASE_URL = 'http://127.0.0.1:43123';
  process.env.RODRIGO_KEY_ID = 'test-key';
  process.env.RODRIGO_PRIVATE_KEY_FILE = keyFile;
  t.after(async () => {
    if (old.url === undefined) delete process.env.RODRIGO_BASE_URL; else process.env.RODRIGO_BASE_URL = old.url;
    if (old.key === undefined) delete process.env.RODRIGO_KEY_ID; else process.env.RODRIGO_KEY_ID = old.key;
    if (old.file === undefined) delete process.env.RODRIGO_PRIVATE_KEY_FILE; else process.env.RODRIGO_PRIVATE_KEY_FILE = old.file;
    await rm(directory, { recursive: true, force: true });
  });

  let sends = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { sends++; return Response.json({ contractVersion: '2', results: [committed()] }); });
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };
  const invalid: RodrigoAction[][] = [
    [action({ appId: 'notes', resourceType: 'event' })],
    [action({ operation: 'create', expectedRevision: 1 })],
    [action({ operation: 'update', expectedRevision: undefined })],
    [action({ appId: 'tasks', resourceType: 'taskBoard', operation: 'delete', expectedRevision: 1, payload: {} })],
    [action({ operation: 'delete', expectedRevision: 1, payload: { unexpected: true } })],
    [action(), action()],
  ];
  for (const actions of invalid) assert.throws(() => submitRodrigoActionBatch(context, { actions }));
  assert.throws(() => submitRodrigoActionBatch(context, { actions: Array.from({ length: 101 }, (_, i) => action({ actionId: `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}` })) }));
  await assert.throws(() => submitRodrigoActionBatch(context, { actions: [action({ payload: { id: 'note-1', title: 'Title', body: 'x'.repeat(262144), updatedAt: '2026-11-09T12:00:00.000Z' } })] }));
  await assert.rejects(() => submitRodrigoActionBatch(context, { actions: ['a', 'b', 'c'].map((suffix, i) => action({
    actionId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, resourceId: `large-${suffix}`,
    payload: { id: `large-${suffix}`, title: 'Title', body: 'x'.repeat(100_000), updatedAt: '2026-11-09T12:00:00.000Z' },
  })) }), RodrigoUnavailableError);
  assert.equal(sends, 0);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('Rodrigo action client signs exact bounded batches and validates independent response results', { concurrency: false }, async (t) => {
  const keys = generateKeyPairSync('ed25519');
  const directory = await mkdtemp(join(tmpdir(), 'rodrigo-actions-'));
  const keyFile = join(directory, 'private.pem');
  await writeFile(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  const old = { url: process.env.RODRIGO_BASE_URL, key: process.env.RODRIGO_KEY_ID, file: process.env.RODRIGO_PRIVATE_KEY_FILE };
  process.env.RODRIGO_BASE_URL = 'http://127.0.0.1:43123'; process.env.RODRIGO_KEY_ID = 'test-key';
  process.env.RODRIGO_PRIVATE_KEY_FILE = keyFile;
  t.after(async () => {
    if (old.url === undefined) delete process.env.RODRIGO_BASE_URL; else process.env.RODRIGO_BASE_URL = old.url;
    if (old.key === undefined) delete process.env.RODRIGO_KEY_ID; else process.env.RODRIGO_KEY_ID = old.key;
    if (old.file === undefined) delete process.env.RODRIGO_PRIVATE_KEY_FILE; else process.env.RODRIGO_PRIVATE_KEY_FILE = old.file;
    await rm(directory, { recursive: true, force: true });
  });
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };
  let reply: unknown = { contractVersion: '2', results: [committed()] };
  let expectedBody = JSON.stringify({ actions: [action()] });
  const mocked = t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    assert.match(headers.get('authorization') ?? '', /^Bearer /);
    assert.equal(headers.get('accept'), 'application/json');
    assert.equal(init?.body, expectedBody);
    return Response.json(reply);
  });
  assert.deepEqual(await submitRodrigoActionBatch(context, { actions: [action()] }), { contractVersion: '2', results: [committed()] });
  assert.equal(mocked.mock.callCount(), 1);

  const second = action({ actionId: 'f101ce6a-a472-4e49-9a5b-02b43fcc0147', resourceId: 'note-2', payload: { id: 'note-2', title: 'Second', body: '', updatedAt: '2026-11-09T12:00:00.000Z' } });
  reply = { contractVersion: '2', results: [committed(second.actionId), committed(actionId)] };
  expectedBody = JSON.stringify({ actions: [action(), second] });
  assert.equal((await submitRodrigoActionBatch(context, { actions: [action(), second] })).results.length, 2,
    'result order is independent; actionId correlates each outcome');

  const boundaryActions = ['a', 'b', 'c'].map((suffix, i) => action({
    actionId: `00000000-0000-4000-8000-${String(i + 11).padStart(12, '0')}`, resourceId: `boundary-${suffix}`,
    payload: { id: `boundary-${suffix}`, title: 'Title', body: '', updatedAt: '2026-11-09T12:00:00.000Z' },
  }));
  const baselineBytes = Buffer.byteLength(JSON.stringify({ actions: boundaryActions }));
  const fillerSize = 262144 - baselineBytes;
  const perAction = Math.floor(fillerSize / boundaryActions.length);
  boundaryActions.forEach((item, i) => { item.payload.body = 'x'.repeat(perAction + (i === boundaryActions.length - 1 ? fillerSize % boundaryActions.length : 0)); });
  expectedBody = JSON.stringify({ actions: boundaryActions });
  reply = { contractVersion: '2', results: [committed()] };
  assert.equal(Buffer.byteLength(expectedBody), 262144);
  reply = { contractVersion: '2', results: boundaryActions.map((item) => committed(item.actionId)) };
  assert.equal((await submitRodrigoActionBatch(context, { actions: boundaryActions })).results.length, 3);

  for (const malformed of [
    { contractVersion: '2', results: [] },
    { contractVersion: '2', results: [committed('f101ce6a-a472-4e49-9a5b-02b43fcc0147')] },
    { contractVersion: '2', results: [{ actionId, status: 'committed' }] },
    { contractVersion: '2', results: [{ actionId, status: 'conflict' }] },
    { contractVersion: '2', results: [{ ...committed(), extra: true }] },
  ]) {
    expectedBody = JSON.stringify({ actions: [action()] });
    reply = malformed;
    await assert.rejects(() => submitRodrigoActionBatch(context, { actions: [action()] }), RodrigoUnavailableError);
  }
  assert.equal(mocked.mock.callCount(), 8);
});

test('Rodrigo action client preserves machine errors and never retries an ambiguous mutation', { concurrency: false }, async (t) => {
  const keys = generateKeyPairSync('ed25519');
  const directory = await mkdtemp(join(tmpdir(), 'rodrigo-actions-'));
  const keyFile = join(directory, 'private.pem');
  await writeFile(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  const old = { url: process.env.RODRIGO_BASE_URL, key: process.env.RODRIGO_KEY_ID, file: process.env.RODRIGO_PRIVATE_KEY_FILE };
  process.env.RODRIGO_BASE_URL = 'http://127.0.0.1:43123'; process.env.RODRIGO_KEY_ID = 'test-key';
  process.env.RODRIGO_PRIVATE_KEY_FILE = keyFile;
  t.after(async () => {
    if (old.url === undefined) delete process.env.RODRIGO_BASE_URL; else process.env.RODRIGO_BASE_URL = old.url;
    if (old.key === undefined) delete process.env.RODRIGO_KEY_ID; else process.env.RODRIGO_KEY_ID = old.key;
    if (old.file === undefined) delete process.env.RODRIGO_PRIVATE_KEY_FILE; else process.env.RODRIGO_PRIVATE_KEY_FILE = old.file;
    await rm(directory, { recursive: true, force: true });
  });
  const context = { userId: 'user-1', workspaceId: 'workspace-1' };
  const requestId = '48a9da43-9b66-4d88-96c9-3413b4ae3049';
  const mocked = t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'idempotency_conflict', requestId } }, { status: 409 }));
  await assert.rejects(() => submitRodrigoActionBatch(context, { actions: [action()] }), (error: unknown) => {
    assert.ok(error instanceof RodrigoResponseError); assert.equal(error.status, 409); assert.equal(error.code, 'idempotency_conflict'); assert.equal(error.requestId, requestId); return true;
  });
  assert.equal(mocked.mock.callCount(), 1);
  mocked.mock.mockImplementation(async () => { throw new Error('timeout after commit'); });
  await assert.rejects(() => submitRodrigoActionBatch(context, { actions: [action()] }), RodrigoUnavailableError);
  assert.equal(mocked.mock.callCount(), 2);
});
