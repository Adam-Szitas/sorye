import assert from 'node:assert/strict';
import { test } from 'node:test';
import postgres from 'postgres';
import type { MessengerMessage } from '@sorye/types';
import { paginateChannelMessages } from '../lib/store/messenger-list';
import { readBoundedFormData, UploadLimitError, withUploadSlot } from '../lib/bounded-upload';
import { jobId } from '../lib/jobs';

function message(id: string, createdAt: string): MessengerMessage {
  return {
    id, channelId: 'channel-a', workspaceId: 'workspace-a', kind: 'text',
    text: id, author: { id: 'user-a', name: 'User' }, createdAt,
  };
}

test('Messenger after cursor keeps same-timestamp messages and reports bounded pages', () => {
  const time = '2026-10-28T10:00:00.000Z';
  const messages = ['a', 'b', 'c', 'd'].map((id) => message(id, time));
  const first = paginateChannelMessages(messages, { after: time, afterId: 'a', limit: 2 });
  assert.equal(first.status, 'ok');
  if (first.status !== 'ok') return;
  assert.deepEqual(first.messages.map((m) => m.id), ['b', 'c']);
  assert.equal(first.hasMore, true);
  const next = paginateChannelMessages(messages, {
    after: first.messages.at(-1)!.createdAt,
    afterId: first.messages.at(-1)!.id,
    limit: 2,
  });
  assert.equal(next.status, 'ok');
  if (next.status === 'ok') {
    assert.deepEqual(next.messages.map((m) => m.id), ['d']);
    assert.equal(next.hasMore, false);
  }
});

test('Messenger older cursor returns the immediately preceding page in ascending order', () => {
  const messages = ['a', 'b', 'c', 'd'].map((id, n) => message(id, `2026-10-28T10:00:0${n}.000Z`));
  const page = paginateChannelMessages(messages, { before: 'd', limit: 2 });
  assert.equal(page.status, 'ok');
  if (page.status === 'ok') {
    assert.deepEqual(page.messages.map((m) => m.id), ['b', 'c']);
    assert.equal(page.hasMore, true);
  }
});

test('job idempotency is stable and scoped by workspace, user and job kind', () => {
  const base = jobId('w1', 'u1', 'ocr', 'request-1');
  assert.equal(base, jobId('w1', 'u1', 'ocr', 'request-1'));
  assert.notEqual(base, jobId('w2', 'u1', 'ocr', 'request-1'));
  assert.notEqual(base, jobId('w1', 'u2', 'ocr', 'request-1'));
  assert.notEqual(base, jobId('w1', 'u1', 'relay', 'request-1'));
});

test('upload admission enforces two concurrent slots and releases after errors', async () => {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = withUploadSlot(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
  const second = withUploadSlot(() => new Promise<void>((resolve) => { releaseSecond = resolve; }));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(withUploadSlot(async () => undefined), (error: unknown) =>
    error instanceof UploadLimitError && error.status === 429,
  );
  releaseFirst();
  releaseSecond();
  await first;
  await second;
  await withUploadSlot(async () => { throw new Error('expected'); }).catch(() => undefined);
  await withUploadSlot(async () => undefined);
});

test('bounded multipart parser rejects a body over the cap without Content-Length', async () => {
  const form = new FormData();
  form.set('value', 'x'.repeat(200));
  const request = new Request('http://localhost/upload', { method: 'POST', body: form });
  await assert.rejects(readBoundedFormData(request, 100), (error: unknown) =>
    error instanceof UploadLimitError && error.status === 413,
  );
});

test('local PostgreSQL is reachable and has the Hub query schema', async (t) => {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ??
    'postgresql://sorye:sorye@127.0.0.1:15432/sorye';
  const sql = postgres(url, { max: 1, connect_timeout: 2 });
  try {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    const names = new Set(tables.map((row) => row.table_name));
    for (const required of ['messenger_messages', 'background_jobs', 'workspace_app_docs']) {
      assert.ok(names.has(required), `missing schema table ${required}`);
    }
    const indexes = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where schemaname = 'public'
    `;
    assert.ok(indexes.some((row) => row.indexname.includes('messenger') && row.indexname.includes('created')),
      'expected a Messenger pagination index');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error &&
      ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(String(error.code))) {
      t.skip('PostgreSQL is not running; start it with pnpm db:up to run this integration check');
      return;
    }
    throw error;
  } finally {
    await sql.end({ timeout: 1 });
  }
});
