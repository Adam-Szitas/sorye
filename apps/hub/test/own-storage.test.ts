import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { UploadRecord } from '@sorye/types';

// Minimal Hub environment. The JSON store writes under process.cwd()/.data, so run in a temp dir.
const workdir = mkdtempSync(path.join(tmpdir(), 'sorye-own-storage-'));
const previousCwd = process.cwd();
Object.assign(process.env, {
  NODE_ENV: 'test',
  STORE_DRIVER: 'json',
  AUTH_SECRET: 'test-auth-secret-at-least-sixteen',
  ADMIN_SECRET: 'test-admin-secret',
  STORAGE_SECRET_KEY: 'k'.repeat(48),
});

type Modules = {
  guard: typeof import('../lib/upload-storage/net-guard');
  validate: typeof import('../lib/upload-storage/validate');
  crypto: typeof import('../lib/storage-crypto');
  pg: typeof import('../lib/upload-storage/pg-url');
  store: typeof import('../lib/upload-storage/store');
  drive: typeof import('../lib/upload-storage/drive');
};
let m: Modules;

before(async () => {
  process.chdir(workdir);
  m = {
    guard: await import('../lib/upload-storage/net-guard'),
    validate: await import('../lib/upload-storage/validate'),
    crypto: await import('../lib/storage-crypto'),
    pg: await import('../lib/upload-storage/pg-url'),
    store: await import('../lib/upload-storage/store'),
    drive: await import('../lib/upload-storage/drive'),
  };
});

after(() => {
  process.chdir(previousCwd);
  rmSync(workdir, { recursive: true, force: true });
});

test('only public addresses pass, including IPv4 hidden inside IPv6', () => {
  const blocked = [
    '10.0.0.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '172.16.5.4', '192.168.1.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:c0a8:101::1',
    'fd00::1', 'fc12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '2001:db8::1', '2001:0:4136:e378:8000:63bf:80ff:fffe',
  ];
  for (const address of blocked) assert.equal(m.guard.isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
    assert.equal(m.guard.isPublicAddress(address), true, address);
  }
  for (const junk of ['', 'localhost', '999.1.1.1', '1.2.3', 'gggg::1']) assert.equal(m.guard.isPublicAddress(junk), false, junk);
});

test('names that resolve to private addresses are refused', async () => {
  await assert.rejects(m.guard.resolvePublicAddress('localhost', false), (error: { reason?: string }) => error.reason === 'host_not_allowed');
  await assert.rejects(m.guard.resolvePublicAddress('169.254.169.254', false), (error: { reason?: string }) => error.reason === 'host_not_allowed');
  await assert.rejects(m.guard.resolvePublicAddress('no-such-host.invalid', false), (error: { reason?: string }) => error.reason === 'host_unresolved');
  // Development mode may reach local services.
  const local = await m.guard.resolvePublicAddress('127.0.0.1', true);
  assert.equal(local.address, '127.0.0.1');
});

test('host names are normalised and single labels only allowed in development', () => {
  assert.equal(m.guard.normalizeHost(' DB.Example.COM. '), 'db.example.com');
  assert.equal(m.guard.normalizeHost('postgres'), null);
  assert.equal(m.guard.normalizeHost('postgres', true), 'postgres');
  for (const bad of ['a..b.com', '-a.com', 'a_b.com', 'x'.repeat(254) + '.com', 'host/path.com', 'user@host.com']) {
    assert.equal(m.guard.normalizeHost(bad), null, bad);
  }
});

const goodDrive = {
  provider: 's3-compatible', bucket: 'acme-files', region: 'us-east-1', endpoint: 'https://s3.eu-central-003.backblazeb2.com',
  prefix: 'sorye/', accessKeyId: 'AKIAEXAMPLE1234', secretAccessKey: 'secret-key-example-0000', limitGb: 50,
};

test('drive input: accepted shape and server-built locations', () => {
  const { config, secret } = m.validate.validateDriveInput(goodDrive, false);
  assert.equal(config.endpoint, 'https://s3.eu-central-003.backblazeb2.com');
  assert.equal(config.pathStyle, true);
  assert.equal(config.limitBytes, 50 * 1024 ** 3);
  assert.equal(secret.accessKeyId, 'AKIAEXAMPLE1234');
  assert.equal(m.drive.driveObjectKey(config, 'ws-1', 'f0e7c0de-0000-4000-8000-000000000001'), 'sorye/ws-1/f0e7c0de-0000-4000-8000-000000000001');
  assert.throws(() => m.drive.driveObjectKey(config, 'ws/../other', 'x'));
  const r2 = m.validate.validateDriveInput({ ...goodDrive, provider: 'cloudflare-r2', accountId: 'A'.repeat(32).toLowerCase().replace(/a/g, 'a') }, false);
  assert.equal(m.drive.driveEndpoint(r2.config), `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`);
  const aws = m.validate.validateDriveInput({ ...goodDrive, provider: 'aws-s3', region: 'eu-central-1', endpoint: 'https://evil.example' }, false);
  assert.equal(m.drive.driveEndpoint(aws.config), 'https://s3.eu-central-1.amazonaws.com', 'AWS ignores a supplied endpoint');
});

test('drive input: rejects unsafe endpoints, prefixes, buckets and keys', () => {
  const rejects = (patch: Record<string, unknown>, field: string, insecure = false) =>
    assert.throws(() => m.validate.validateDriveInput({ ...goodDrive, ...patch }, insecure), (error: { field?: string }) => error.field === field, JSON.stringify(patch));
  rejects({ endpoint: 'http://s3.example.com' }, 'endpoint');
  rejects({ endpoint: 'https://user:pw@s3.example.com' }, 'endpoint');
  rejects({ endpoint: 'https://s3.example.com/bucket' }, 'endpoint');
  rejects({ endpoint: 'https://s3.example.com/?x=1' }, 'endpoint');
  rejects({ endpoint: 'file:///etc/passwd' }, 'endpoint');
  rejects({ endpoint: 'https://minio/' }, 'endpoint');
  rejects({ prefix: '../escape/' }, 'prefix');
  rejects({ prefix: '/absolute/' }, 'prefix');
  rejects({ prefix: 'a//b/' }, 'prefix');
  rejects({ prefix: 'a/./b/' }, 'prefix');
  rejects({ bucket: 'Upper' }, 'bucket');
  rejects({ bucket: '192.168.1.1' }, 'bucket');
  rejects({ bucket: 'ab' }, 'bucket');
  rejects({ accessKeyId: 'has space key' }, 'accessKeyId');
  rejects({ secretAccessKey: 'short' }, 'secretAccessKey');
  rejects({ limitGb: 0 }, 'limitGb');
  rejects({ limitGb: 1e9 }, 'limitGb');
  rejects({ limitGb: 'NaN' }, 'limitGb');
  rejects({ provider: 'gcs' }, 'provider');
  rejects({ provider: 'aws-s3', region: 'moon-1' }, 'region');
  rejects({ provider: 'cloudflare-r2', accountId: 'not-hex' }, 'accountId');
  // Development mode allows plain HTTP and single-label hosts, for a local MinIO.
  assert.equal(m.validate.validateDriveInput({ ...goodDrive, endpoint: 'http://minio:9000' }, true).config.endpoint, 'http://minio:9000');
});

const goodDatabase = { host: 'db.example.com', port: 5432, database: 'acme', user: 'sorye_uploader', password: 'p@ss word!', schema: 'sorye_uploads', tls: 'verify', limitGb: 10 };

test('database input: identifiers are strict, TLS is required outside development', () => {
  const { config, secret } = m.validate.validateDatabaseInput(goodDatabase, false);
  assert.equal(config.schema, 'sorye_uploads');
  assert.equal(secret.password, 'p@ss word!');
  const rejects = (patch: Record<string, unknown>, field: string) =>
    assert.throws(() => m.validate.validateDatabaseInput({ ...goodDatabase, ...patch }, false), (error: { field?: string }) => error.field === field, JSON.stringify(patch));
  rejects({ schema: 'public' }, 'schema');
  rejects({ schema: 'pg_catalog' }, 'schema');
  rejects({ schema: 'x; drop table users' }, 'schema');
  rejects({ schema: 'Mixed' }, 'schema');
  rejects({ database: 'a b' }, 'database');
  rejects({ user: 'x"; --' }, 'user');
  rejects({ host: 'postgres' }, 'host');
  rejects({ host: 'db.example.com:5432' }, 'host');
  rejects({ port: 70000 }, 'port');
  rejects({ password: 'a\u0000b' }, 'password');
  rejects({ tls: 'disable' }, 'tls');
  rejects({ tls: 'off' }, 'tls');
  rejects({ caPem: 'not a certificate' }, 'caPem');
  rejects({ tls: 'encrypt', caPem: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----' }, 'caPem');
  assert.equal(m.validate.validateDatabaseInput({ ...goodDatabase, host: 'postgres', tls: 'disable' }, true).config.tls, 'disable');
});

test('secrets are bound to their workspace and field', () => {
  const sealed = m.crypto.encryptBoundStorageSecret('{"password":"x"}', 'own-storage:database:ws-a');
  assert.equal(m.crypto.decryptBoundStorageSecret(sealed, 'own-storage:database:ws-a'), '{"password":"x"}');
  assert.throws(() => m.crypto.decryptBoundStorageSecret(sealed, 'own-storage:database:ws-b'));
  assert.throws(() => m.crypto.decryptBoundStorageSecret(sealed, 'own-storage:drive:ws-a'));
  const parts = sealed.split('.');
  const tampered = [...parts.slice(0, 3), Buffer.from('changed').toString('base64')].join('.');
  assert.throws(() => m.crypto.decryptBoundStorageSecret(tampered, 'own-storage:database:ws-a'));
  assert.notEqual(m.crypto.encryptBoundStorageSecret('same', 'c'), m.crypto.encryptBoundStorageSecret('same', 'c'), 'fresh IV each time');
});

test('workspace database URLs: TLS enforced, private hosts refused', async () => {
  await assert.rejects(m.pg.safePostgresOptions('postgres://u:p@db.example.com/acme?sslmode=disable', false), (e: { reason?: string }) => e.reason === 'tls_required');
  await assert.rejects(m.pg.safePostgresOptions('postgres://u:p@127.0.0.1/acme', false), (e: { reason?: string }) => e.reason === 'host_not_allowed');
  await assert.rejects(m.pg.safePostgresOptions('postgres://u:p@169.254.169.254/acme', false), (e: { reason?: string }) => e.reason === 'host_not_allowed');
  await assert.rejects(m.pg.safePostgresOptions('mysql://u:p@db.example.com/acme', false), (e: { reason?: string }) => e.reason === 'invalid_input');
  const pinned = await m.pg.safePostgresOptions('postgres://u:p%40ss@1.1.1.1:6543/acme?sslmode=verify-full', false);
  assert.equal(pinned.host, '1.1.1.1');
  assert.equal(pinned.port, 6543);
  assert.equal(pinned.password, 'p@ss');
  assert.deepEqual((pinned.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized, true);
  const encryptOnly = await m.pg.safePostgresOptions('postgres://u:p@1.1.1.1/acme', false);
  assert.equal((encryptOnly.ssl as { rejectUnauthorized: boolean }).rejectUnauthorized, false, 'no sslmode still encrypts');
});

function record(id: string, size: number, target: UploadRecord['target'] = 'drive'): UploadRecord {
  return {
    id, workspaceId: 'ws-quota', fileId: id, userId: 'u1', target, location: null, displayName: `${id}.pdf`, mime: 'application/pdf',
    size, sha256: 'a'.repeat(64), sourceAppId: 'files', status: 'pending', errorCode: null, createdAt: new Date().toISOString(), completedAt: null,
  };
}

test('space is reserved atomically: parallel uploads cannot overshoot the limit', async () => {
  const limit = 1_000;
  const results = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => m.store.reserveUpload(record(`r${n}`, 400), limit)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason instanceof m.store.QuotaExceededError));
  const used = await m.store.usage('ws-quota', 'drive');
  assert.equal(used.usedBytes, 800);
  // A finished upload keeps counting; a failed one frees its space; another target is separate.
  await m.store.finishUpload('ws-quota', 'r1', { status: 'stored', location: 'sorye/ws-quota/r1' });
  await m.store.finishUpload('ws-quota', 'r2', { status: 'failed', errorCode: 'unreachable' });
  assert.deepEqual(await m.store.usage('ws-quota', 'drive'), { usedBytes: 400, fileCount: 1 });
  await m.store.reserveUpload(record('db1', 900, 'database'), 1_000);
  await m.store.markFileDeleted('ws-quota', 'r1');
  assert.deepEqual(await m.store.usage('ws-quota', 'drive'), { usedBytes: 0, fileCount: 0 });
  const history = await m.store.recentUploads('ws-quota');
  assert.ok(history.some((row) => row.id === 'r1' && row.status === 'deleted'), 'deleted uploads stay in the ledger');
});
