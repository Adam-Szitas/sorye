import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { planUploadBatch, FILE_UPLOAD_BATCH_UNKNOWN_SPEED } from '@sorye/types';

// The JSON store writes under process.cwd()/.data, so run in a temp dir.
const workdir = mkdtempSync(path.join(tmpdir(), 'sorye-drive-uploads-'));
const previousCwd = process.cwd();
Object.assign(process.env, {
  NODE_ENV: 'test',
  STORE_DRIVER: 'json',
  FILE_STORE_DRIVER: 'local',
  AUTH_SECRET: 'test-auth-secret-at-least-sixteen',
  ADMIN_SECRET: 'test-admin-secret',
});

type Modules = {
  throttle: typeof import('../lib/upload-throttle');
  bounded: typeof import('../lib/bounded-upload');
  files: typeof import('../lib/files');
  blobs: typeof import('../lib/file-blobs');
  speed: typeof import('../lib/upload-speed');
  notices: typeof import('../lib/upload-notices');
  notifications: typeof import('../lib/notifications');
  ledger: typeof import('../lib/upload-storage/store');
};
let m: Modules;

before(async () => {
  process.chdir(workdir);
  m = {
    throttle: await import('../lib/upload-throttle'),
    bounded: await import('../lib/bounded-upload'),
    files: await import('../lib/files'),
    blobs: await import('../lib/file-blobs'),
    speed: await import('../lib/upload-speed'),
    notices: await import('../lib/upload-notices'),
    notifications: await import('../lib/notifications'),
    ledger: await import('../lib/upload-storage/store'),
  };
});

after(async () => {
  process.chdir(previousCwd);
  // Let store writes that were started by the last test settle; Windows refuses to delete open files.
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    rmSync(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // A leftover temp directory must not fail the suite.
  }
});

const uploader = { userId: 'user-1', tier: 'free' as const };
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const text = (value: string) => Buffer.from(value, 'utf8');

// ── Quota ────────────────────────────────────────────────────────────────────

test('quota reports server limits and usage of the workspace', async () => {
  const limits = { maxBatchFiles: 25, maxConcurrentUploads: 2, throttleBytesPerSecond: null };
  const empty = await m.files.getFileQuota('ws-quota', limits);
  assert.equal(empty.fileCount, 0);
  assert.equal(empty.usedBytes, 0);
  assert.equal(empty.limitBytes, null);
  assert.equal(empty.target, 'sorye');
  assert.equal(empty.maxFileBytes, 64 * 1024 * 1024);
  assert.equal(empty.maxFiles, 200);

  await m.files.createWorkspaceFile({ workspaceId: 'ws-quota', displayName: 'a.txt', bytes: text('hello world'), uploader });
  await m.files.createWorkspaceFile({ workspaceId: 'ws-quota', displayName: 'b.txt', bytes: text('second file!'), uploader });
  const used = await m.files.getFileQuota('ws-quota', { ...limits, throttleBytesPerSecond: 1000 });
  assert.equal(used.fileCount, 2);
  assert.equal(used.usedBytes, 11 + 12);
  assert.equal(used.throttleBytesPerSecond, 1000);
  // Another workspace's files never count.
  assert.equal((await m.files.getFileQuota('ws-other', limits)).fileCount, 0);
});

test('quota limits come from the same config that enforces them', () => {
  const config = m.throttle.readUploadThrottleConfig({ FILE_UPLOAD_MAX_INFLIGHT_PER_USER: '5', FILE_UPLOAD_THROTTLE_USER_BPS: '4000', FILE_UPLOAD_THROTTLE_GLOBAL_BPS: '3000' } as unknown as NodeJS.ProcessEnv);
  const limits = m.throttle.quotaLimits(config);
  // Never more than the process-wide slots, and the lowest throughput limit wins.
  assert.equal(limits.maxConcurrentUploads, m.throttle.PROCESS_UPLOAD_SLOTS);
  assert.equal(limits.throttleBytesPerSecond, 3000);
});

// ── Batch plan and speed estimate ───────────────────────────────────────────

test('batch plan caps files by connection speed, server ceiling and unknown speed', () => {
  const mb = 1024 * 1024;
  // 1 MB/s for 300 s: ten 20 MB files take ~200 s → all fit until ~300 s.
  const slow = planUploadBatch(Array(30).fill(20 * mb), { bytesPerSecond: mb, maxBatchFiles: 25 });
  assert.equal(slow.limitedBy, 'connection');
  assert.equal(slow.accepted, 14);
  assert.ok(slow.estimateSeconds! <= 300);
  // Fast link: the server ceiling applies.
  const fast = planUploadBatch(Array(40).fill(mb), { bytesPerSecond: 100 * mb, maxBatchFiles: 25 });
  assert.deepEqual([fast.accepted, fast.limitedBy], [25, 'server']);
  // One file larger than the whole budget is still accepted.
  assert.equal(planUploadBatch([64 * mb, mb], { bytesPerSecond: 10_000, maxBatchFiles: 25 }).accepted, 1);
  // Unknown speed: a fixed conservative batch.
  const unknown = planUploadBatch(Array(30).fill(mb), { bytesPerSecond: null, maxBatchFiles: 25 });
  assert.deepEqual([unknown.accepted, unknown.limitedBy], [FILE_UPLOAD_BATCH_UNKNOWN_SPEED, 'unknown-speed']);
  assert.equal(planUploadBatch([], { bytesPerSecond: mb, maxBatchFiles: 25 }).accepted, 0);
});

test('speed estimate prefers measurements, then the connection hint, and respects a server throttle', () => {
  const now = 1_000_000_000;
  const small = m.speed.addSpeedSample(null, 1_000, 10, now);
  assert.equal(small, null, 'tiny uploads are not samples');
  const first = m.speed.addSpeedSample(null, 2_000_000, 1_000, now)!;
  assert.equal(first.bytesPerSecond, 2_000_000);
  const second = m.speed.addSpeedSample(first, 1_000_000, 1_000, now)!;
  assert.ok(second.bytesPerSecond < 2_000_000 && second.bytesPerSecond > 1_000_000);

  assert.equal(m.speed.estimateUploadSpeed({ measured: first, downlinkMbps: 100, now }).source, 'measured');
  const hint = m.speed.estimateUploadSpeed({ measured: null, downlinkMbps: 8, now });
  assert.deepEqual([hint.source, hint.bytesPerSecond], ['connection', 500_000]);
  const stale = m.speed.estimateUploadSpeed({ measured: first, downlinkMbps: null, now: now + m.speed.SAMPLE_MAX_AGE_MS + 1 });
  assert.equal(stale.bytesPerSecond, null);
  const capped = m.speed.estimateUploadSpeed({ measured: first, throttleBytesPerSecond: 100_000, now });
  assert.deepEqual([capped.bytesPerSecond, capped.limitedByServer], [100_000, true]);
});

// ── Throttling ──────────────────────────────────────────────────────────────

test('throttling is off by default', () => {
  const config = m.throttle.readUploadThrottleConfig({} as unknown as NodeJS.ProcessEnv);
  assert.equal(m.throttle.throttleEnabled(config), false);
  assert.equal(m.throttle.effectiveBytesPerSecond(config), null);
  assert.deepEqual(m.throttle.uploadBuckets({ userId: 'u', workspaceId: 'w' }, config), []);
  const invalid = m.throttle.readUploadThrottleConfig({ FILE_UPLOAD_THROTTLE_GLOBAL_BPS: '-5', FILE_UPLOAD_THROTTLE_USER_BPS: 'fast' } as unknown as NodeJS.ProcessEnv);
  assert.equal(m.throttle.throttleEnabled(invalid), false);
});

test('a bucket admits one burst, then paces bytes at its rate across callers', () => {
  let clock = 10_000;
  const bucket = new m.throttle.ThroughputBucket(100_000, () => clock);
  assert.equal(bucket.reserve(100_000), 0, 'one second of burst is free');
  assert.equal(Math.round(bucket.reserve(50_000)), 500);
  // A second caller queues behind the first booking.
  assert.equal(Math.round(bucket.reserve(50_000)), 1000);
  clock += 5_000;
  assert.equal(bucket.reserve(10_000), 0, 'idle time refills the burst');
});

test('user, workspace and global buckets apply together; the slowest one sets the pace', () => {
  const config = m.throttle.readUploadThrottleConfig({
    FILE_UPLOAD_THROTTLE_USER_BPS: '1000000', FILE_UPLOAD_THROTTLE_WORKSPACE_BPS: '500000', FILE_UPLOAD_THROTTLE_GLOBAL_BPS: '2000000',
  } as unknown as NodeJS.ProcessEnv);
  const a = m.throttle.uploadBuckets({ userId: 'ua', workspaceId: 'shared' }, config);
  const b = m.throttle.uploadBuckets({ userId: 'ub', workspaceId: 'shared' }, config);
  assert.equal(a.length, 3);
  assert.notEqual(a[0], b[0], 'members have their own bucket');
  assert.equal(a[1], b[1], 'one bucket per workspace');
  assert.equal(a[2], b[2], 'one global bucket');
  assert.equal(m.throttle.effectiveBytesPerSecond(config), 500_000);
  assert.ok(m.throttle.uploadTimeoutMs(64 * 1024 * 1024, 500_000) > 120_000, 'throttled bodies get more time');
  assert.equal(m.throttle.uploadTimeoutMs(1024, null), 120_000);
});

function multipart(bytes: number): Request {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes).fill(65)], 'big.txt', { type: 'text/plain' }));
  return new Request('http://hub.test/api/files', { method: 'POST', body: form });
}

test('the server reads a throttled upload body no faster than the limit', async () => {
  const rate = 100_000;
  const started = performance.now();
  const form = await m.bounded.readBoundedFormData(multipart(300_000), 1_000_000, {
    buckets: [new m.throttle.ThroughputBucket(rate)],
  });
  const elapsed = performance.now() - started;
  assert.equal((form.get('file') as File).size, 300_000);
  // First 100 kB are burst; the remaining ~200 kB need ~2 s at 100 kB/s.
  assert.ok(elapsed >= 1_800, `throttled read took ${Math.round(elapsed)} ms`);

  const fastStart = performance.now();
  await m.bounded.readBoundedFormData(multipart(300_000), 1_000_000);
  assert.ok(performance.now() - fastStart < 1_000, 'unthrottled read is not delayed');
});

test('one member cannot hold more upload slots than allowed', async () => {
  const config = m.throttle.readUploadThrottleConfig({ FILE_UPLOAD_MAX_INFLIGHT_PER_USER: '2' } as unknown as NodeJS.ProcessEnv);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const running = [
    m.throttle.withUserUploadSlot('busy-user', () => gate, config),
    m.throttle.withUserUploadSlot('busy-user', () => gate, config),
  ];
  await assert.rejects(m.throttle.withUserUploadSlot('busy-user', async () => undefined, config), m.throttle.UserUploadBusyError);
  // Other members are unaffected.
  await m.throttle.withUserUploadSlot('other-user', async () => undefined, config);
  release();
  await Promise.all(running);
  await m.throttle.withUserUploadSlot('busy-user', async () => undefined, config);
});

// ── Checksums ───────────────────────────────────────────────────────────────

test('a matching browser checksum is accepted and stored', async () => {
  const bytes = text('checksum me');
  const file = await m.files.createWorkspaceFile({ workspaceId: 'ws-sum', displayName: 'ok.txt', bytes, uploader, expectedSha256: sha(bytes) });
  assert.equal(file.sha256, sha(bytes));
  assert.equal(await m.blobs.hashFileBlob('ws-sum', file.id), sha(bytes));
});

test('a checksum mismatch is refused as damaged and nothing is stored', async () => {
  const bytes = text('these bytes changed on the way');
  await assert.rejects(
    m.files.createWorkspaceFile({ workspaceId: 'ws-bad', displayName: 'bad.txt', bytes, uploader, expectedSha256: sha(text('original')) }),
    (error: unknown) => error instanceof m.files.FileAccessError && error.status === 422 && error.code === 'checksum_mismatch',
  );
  assert.equal((await m.files.listWorkspaceFiles('ws-bad')).length, 0);
  const ledger = await m.ledger.recentUploads('ws-bad');
  assert.equal(ledger[0]?.status, 'rejected');
  assert.equal(ledger[0]?.errorCode, 'integrity_failed');
});

test('browser checksums must be 64 hex characters', () => {
  assert.equal(m.files.parseClientSha256(undefined), undefined);
  assert.equal(m.files.parseClientSha256(''), undefined);
  assert.equal(m.files.parseClientSha256('xyz'), null);
  assert.equal(m.files.parseClientSha256('A'.repeat(64)), 'a'.repeat(64));
});

test('S3 writes carry SHA-256; a refused or mismatched write marks the upload damaged', async (t) => {
  process.env.FILE_STORE_DRIVER = 's3';
  process.env.FILE_S3_BUCKET = 'test-bucket';
  t.after(() => {
    process.env.FILE_STORE_DRIVER = 'local';
    delete process.env.FILE_S3_BUCKET;
    m.blobs.setFileBlobClientForTests(undefined);
  });
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  let mode: 'ok' | 'echo-wrong' | 'bad-digest' = 'ok';
  m.blobs.setFileBlobClientForTests({
    send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name !== 'PutObjectCommand') return {};
      if (mode === 'bad-digest') throw Object.assign(new Error('digest'), { name: 'BadDigest' });
      return { ChecksumSHA256: mode === 'echo-wrong' ? Buffer.alloc(32).toString('base64') : command.input.ChecksumSHA256 };
    }) as never,
  });

  const bytes = text('stored in s3');
  await m.files.createWorkspaceFile({ workspaceId: 'ws-s3', displayName: 's3.txt', bytes, uploader, expectedSha256: sha(bytes) });
  const put = sent.find((call) => call.name === 'PutObjectCommand')!;
  assert.equal(put.input.ChecksumAlgorithm, 'SHA256');
  assert.equal(put.input.ChecksumSHA256, Buffer.from(sha(bytes), 'hex').toString('base64'));

  for (const next of ['echo-wrong', 'bad-digest'] as const) {
    mode = next;
    sent.length = 0;
    await assert.rejects(
      m.files.createWorkspaceFile({ workspaceId: 'ws-s3', displayName: `${next}.txt`, bytes, uploader, expectedSha256: sha(bytes) }),
      (error: unknown) => error instanceof m.files.FileAccessError && error.status === 422 && error.code === 'integrity_failed',
    );
    if (next === 'echo-wrong') assert.ok(sent.some((call) => call.name === 'DeleteObjectCommand'), 'mismatched object is deleted');
  }
  const files = await m.files.listWorkspaceFiles('ws-s3');
  assert.deepEqual(files.map((file) => file.displayName), ['s3.txt']);
  const failed = (await m.ledger.recentUploads('ws-s3')).filter((row) => row.status === 'failed');
  assert.equal(failed.length, 2);
  assert.ok(failed.every((row) => row.errorCode === 'integrity_failed'));
});

// ── Notices ─────────────────────────────────────────────────────────────────

test('success notices merge per batch; failure notices carry the file to retry', async () => {
  const batchId = '11111111-2222-4333-8444-555555555555';
  const uploadId = '66666666-7777-4888-8999-aaaaaaaaaaaa';
  await m.notices.noteUploadStored({ workspaceId: 'ws-note', userId: 'user-1', batchId, fileName: 'a.txt', size: 1000 });
  const merged = await m.notices.noteUploadStored({ workspaceId: 'ws-note', userId: 'user-1', batchId, fileName: 'b.txt', size: 2000 });
  assert.equal(merged.upload?.stored, 2);
  assert.equal(merged.upload?.bytes, 3000);
  assert.equal(merged.userId, 'user-1');
  assert.equal(merged.actorId, undefined, 'the uploader must see their own notice');
  const failed = await m.notices.noteUploadFailed({
    workspaceId: 'ws-note', userId: 'user-1', uploadId, batchId, fileName: 'c.txt', reason: 'damaged', corrupted: true,
  });
  assert.equal(failed.outcome, 'failure');
  assert.equal(failed.upload?.uploadId, uploadId);
  assert.equal(failed.upload?.corrupted, true);

  // Another member reusing the batch id gets their own row.
  const other = await m.notices.noteUploadStored({ workspaceId: 'ws-note', userId: 'user-2', batchId, fileName: 'x.txt', size: 1 });
  assert.notEqual(other.id, merged.id);
  assert.equal(other.upload?.stored, 1);

  assert.equal(m.notices.parseQueueId('not-a-uuid'), undefined);
  assert.equal(m.notices.parseQueueId(batchId.toUpperCase()), batchId);
});

test('client failure reports are rate limited per member', () => {
  const now = 5_000_000;
  for (let i = 0; i < 30; i += 1) assert.equal(m.notices.allowClientFailureReport('flood', now), true);
  assert.equal(m.notices.allowClientFailureReport('flood', now), false);
  assert.equal(m.notices.allowClientFailureReport('calm', now), true);
  assert.equal(m.notices.allowClientFailureReport('flood', now + 61_000), true);
});
