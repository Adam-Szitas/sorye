import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createDurableActionQueue } from '../src/durable-action-queue';

const id = '550e8400-e29b-41d4-a716-446655440000';
const action = (title = 'first') => ({ actionId: id, appId: 'tasks', resourceType: 'task', operation: 'create', resourceId: id, payloadVersion: 1, payload: { title } });
const freshFactory = () => new IDBFactory();

test('partitions rows by app and opaque user/workspace scope', async () => {
  const indexedDB = freshFactory();
  const one = createDurableActionQueue({ appId: 'tasks', scope: 'opaque-user-a-workspace-a', indexedDB });
  const otherScope = createDurableActionQueue({ appId: 'tasks', scope: 'opaque-user-a-workspace-b', indexedDB });
  const otherApp = createDurableActionQueue({ appId: 'notes', scope: 'opaque-user-a-workspace-a', indexedDB });
  await one.enqueue(action());
  assert.equal((await one.list()).length, 1);
  assert.equal((await otherScope.list()).length, 0);
  assert.equal((await otherApp.list()).length, 0);
});

test('same action ID and payload is idempotent locally; changed payload is rejected', async () => {
  const queue = createDurableActionQueue({ appId: 'tasks', scope: 'scope', indexedDB: freshFactory() });
  const original = await queue.enqueue(action());
  const replay = await queue.enqueue({ payload: { title: 'first' }, resourceId: id, operation: 'create', payloadVersion: 1, resourceType: 'task', appId: 'tasks', actionId: id });
  assert.deepEqual(replay.action, original.action);
  await assert.rejects(queue.enqueue(action('changed')), /different payload/);
  assert.equal((await queue.list()).length, 1);
});

test('queue cap is enforced and no credential-like action fields are persisted', async () => {
  const queue = createDurableActionQueue({ appId: 'tasks', scope: 'scope', maxRows: 1, indexedDB: freshFactory() });
  await assert.rejects(queue.enqueue({ ...action('x'), actionId: '550e8400-e29b-41d4-a716-446655440003', payload: { refreshToken: 'do-not-store' } }), /must not be queued/);
  await queue.enqueue(action());
  await assert.rejects(queue.enqueue({ ...action(), actionId: '550e8400-e29b-41d4-a716-446655440001' }), /queue is full/);
  assert.equal((await queue.list()).length, 1);
});

test('attempts reuse the stored immutable action, and provider outages remain retryable', async () => {
  const indexedDB = freshFactory();
  const queue = createDurableActionQueue({ appId: 'tasks', scope: 'scope', indexedDB });
  const enqueued = await queue.enqueue(action());
  await queue.markAttempt(id);
  await queue.markTransportFailure(id, { code: 'provider_unavailable', message: 'try later' });
  const row = (await queue.list())[0]!;
  assert.equal(row.status, 'failed');
  assert.deepEqual(row.action, enqueued.action);
  await queue.markAttempt(id);
  assert.equal((await queue.list())[0]!.status, 'pending');
  assert.equal((await queue.list())[0]!.attempts, 2);
});

test('only committed and duplicate outcomes clear rows; conflicts and rejections remain visible', async () => {
  const queue = createDurableActionQueue({ appId: 'tasks', scope: 'scope', indexedDB: freshFactory() });
  await queue.enqueue(action());
  await queue.settle({ actionId: id, status: 'conflict', error: { code: 'revision_conflict' } });
  assert.equal((await queue.list())[0]!.status, 'conflict');
  await queue.settle({ actionId: id, status: 'rejected', error: { code: 'provider_unavailable' } });
  assert.equal((await queue.list())[0]!.status, 'failed');
  await queue.settle({ actionId: id, status: 'duplicate' });
  assert.equal((await queue.list()).length, 0);

  const second = { ...action(), actionId: '550e8400-e29b-41d4-a716-446655440002' };
  await queue.enqueue(second);
  await queue.settle({ actionId: second.actionId, status: 'rejected', error: { code: 'invalid_payload' } });
  assert.equal((await queue.list())[0]!.status, 'rejected');
  await queue.settle({ actionId: second.actionId, status: 'committed' });
  assert.equal((await queue.list()).length, 0);
});

test('explicit discard supports user reconciliation', async () => {
  const queue = createDurableActionQueue({ appId: 'tasks', scope: 'scope', indexedDB: freshFactory() });
  await queue.enqueue(action());
  await queue.discard(id);
  assert.deepEqual(await queue.list(), []);
});
