import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HubSession } from '@sorye/types';
import { boundedBytes, callReadOnly, readBackend, readOnlyTools } from '../lib/mcp/read-only';

process.env.AUTH_SECRET = 'mcp-test-only-auth-secret-not-for-production';
process.env.ADMIN_SECRET = 'mcp-test-only-admin-secret-not-for-production';
process.env.AUTH_GOOGLE_ID = 'mcp-test-only-client';
process.env.AUTH_GOOGLE_SECRET = 'mcp-test-only-secret';

const session = { user: { id: 'reader', email: 'reader@example.test' }, workspace: { id: 'workspace-a', ownerId: 'reader', memberIds: ['reader'], selectedAppIds: ['notes', 'files'] } } as HubSession;
test('only enabled read tools are discoverable; mutation and workspace overrides never call Rodrigo', async () => {
  assert(readOnlyTools(session).every(t => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
  assert(!readOnlyTools(session).some(t => t.name === 'read_tasks'));
  let calls = 0;
  const backend = { ...readBackend, listRodrigoResources: async () => { calls++; return { items: [], nextCursor: null }; } };
  for (const [name, args] of [['delete_note', {}], ['read_notes', { type: 'note', workspaceId: 'workspace-b' }], ['read_notes', { type: 'note', url: 'http://elsewhere' }], ['read_notes', { type: 'account' }], ['read_tasks', { type: 'task' }]] as const) {
    await assert.rejects(callReadOnly(session, name, args, backend));
  }
  assert.equal(calls, 0);
});
test('resource reads forward session-derived identity, bounded pagination and cursor', async () => {
  const backend = { ...readBackend, listRodrigoResources: async (...args: Parameters<typeof readBackend.listRodrigoResources>) => {
    assert.deepEqual(args, [{ userId: 'reader', workspaceId: 'workspace-a' }, 'notes', 'note', 12, 'next']);
    return { items: [], nextCursor: null };
  } };
  assert.deepEqual(await callReadOnly(session, 'read_notes', { type: 'note', limit: 12, cursor: 'next' }, backend), { items: [], nextCursor: null });
  await assert.rejects(callReadOnly({ ...session, user: { ...session.user, id: 'outsider' } }, 'read_notes', { type: 'note' }, backend));
});
test('Rodrigo failure propagates without fallback', async () => {
  const backend = { ...readBackend, listRodrigoResources: async () => { throw new Error('offline'); } };
  await assert.rejects(callReadOnly(session, 'read_notes', { type: 'note' }, backend), /offline/);
});
test('stream limits cancel excess data and deadlines terminate stalled readers', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true; } });
  await assert.rejects(boundedBytes(stream, 10), /limit/);
  assert.equal(cancelled, true);
  await assert.rejects(boundedBytes(new ReadableStream(), 10, 10), /deadline/);
});

test('file content goes through Rodrigo and oversized files never open storage', async () => {
  const fileId = 'c47bb0f1-20ba-4bcd-9397-d33440de5b21';
  let opened = 0;
  let size = 3;
  const backend = { ...readBackend,
    getDriveFile: async (context: Parameters<typeof readBackend.getDriveFile>[0], requested: string) => {
      assert.equal(context.workspaceId, 'workspace-a'); assert.equal(requested, fileId);
      return { id: fileId, size, status: 'ready', mime: 'text/plain' } as Awaited<ReturnType<typeof readBackend.getDriveFile>>;
    },
    openDriveContent: async () => { opened++; return new Response('abc'); },
  };
  assert.deepEqual(await callReadOnly(session, 'read_file_content', { id: fileId }, backend), { id: fileId, mimeType: 'text/plain', encoding: 'base64', content: 'YWJj' });
  size = 131073;
  await assert.rejects(callReadOnly(session, 'read_file_content', { id: fileId }, backend), /128 KiB/);
  assert.equal(opened, 1);
});
