import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { docker, harnessConfigured, startRodrigo, type Harness } from './helpers/rodrigo-harness';

process.env.AUTH_SECRET ??= 'test-only-auth-secret-0123456789';
process.env.ADMIN_SECRET ??= 'test-only-admin-secret';
process.env.AUTH_DEV_BYPASS ??= 'true';
process.env.OWN_STORAGE_DEV_INSECURE = 'true';

/**
 * Alignment slice 2: Drive, own storage and the streamed multipart upload path against the
 * real Rodrigo binary, PostgreSQL and S3. The disposable stack's own S3 bucket and
 * PostgreSQL stand in for a customer's bucket and database (dev-insecure mode only).
 */
const MiB = 1024 * 1024;
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const login = () => {
  const suffix = randomUUID().slice(0, 8);
  return { id: `st-${suffix}`, email: `st-${suffix}@example.test`, displayName: `Storage ${suffix}`, isAdmin: false };
};
function pngBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return bytes;
}
function multipartRequest(fields: Array<[string, string]>, file: { name: string; bytes: Buffer }, fieldsAfter: Array<[string, string]> = []) {
  const form = new FormData();
  for (const [k, v] of fields) form.append(k, v);
  form.append('file', new Blob([new Uint8Array(file.bytes)]), file.name);
  for (const [k, v] of fieldsAfter) form.append(k, v);
  return new Request('http://hub.test/api/files', { method: 'POST', body: form });
}

describe('storage owned by Rodrigo', { skip: !harnessConfigured, concurrency: false }, () => {
  let rodrigo: Harness;
  before(async () => { rodrigo = await startRodrigo({ extraProviders: { enforce_membership: true } }); });
  after(async () => {
    (await import('../lib/rodrigo/changes')).stopRodrigoChangeStream();
    await rodrigo?.stop();
  });

  test('multipart parser streams the file and finds fields on both sides', async () => {
    const { parseMultipartUpload } = await import('../lib/multipart-stream');
    const bytes = pngBytes(3 * MiB + 17);
    const req = multipartRequest([['sourceAppId', 'files']], { name: 'a.png', bytes }, [['sha256', sha256(bytes)]]);
    const upload = await parseMultipartUpload(req.body!, req.headers.get('content-type'));
    assert.equal(upload.fields.get('sourceAppId'), 'files');
    assert.equal(upload.fileName, 'a.png');
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of upload.file) { hash.update(chunk); size += chunk.byteLength; }
    assert.equal(size, bytes.length);
    assert.equal(hash.digest('hex'), sha256(bytes));
    assert.equal((await upload.fieldsAfterFile()).get('sha256'), sha256(bytes));
  });

  test('Drive upload through the streamed path: list, read, rename, delete, ledger', async () => {
    const store = await import('../lib/store');
    const files = await import('../lib/files');
    const { parseMultipartUpload } = await import('../lib/multipart-stream');
    const user = login();
    const session = await store.resolveLoginSession(user);
    const actor = { userId: user.id, workspaceId: session.workspace.id };
    const bytes = pngBytes(9 * MiB + 5);
    const req = multipartRequest([['sourceAppId', 'files']], { name: 'photo.png', bytes }, [['sha256', sha256(bytes)]]);
    const upload = await parseMultipartUpload(req.body!, req.headers.get('content-type'));
    const created = await files.createWorkspaceFileFromStream({
      workspaceId: session.workspace.id, uploader: { userId: user.id }, displayName: upload.fileName, source: upload.file,
      maxBytes: 64 * MiB, finalSha256: async () => (await upload.fieldsAfterFile()).get('sha256'),
    });
    assert.equal(created.size, bytes.length);
    assert.equal(created.mime, 'image/png');
    assert.equal(created.sha256, sha256(bytes));
    assert.equal(created.storedIn, 'sorye');
    assert.deepEqual((await files.listWorkspaceFiles(actor)).map((f) => f.id), [created.id]);
    const { bytes: read } = await files.readWorkspaceFileBytes(actor, created.id);
    assert.equal(sha256(read), sha256(bytes));
    const ranged = await files.streamWorkspaceFile(actor, created.id, 'bytes=0-7');
    assert.equal(ranged.status, 206);
    assert.equal((await files.renameWorkspaceFile(actor, created.id, 'renamed.png')).displayName, 'renamed.png');
    const quota = await files.getFileQuota(actor, { maxConcurrentUploads: 2, throttleBytesPerSecond: null, maxBatchFiles: 25 });
    assert.equal(quota.fileCount, 1);
    assert.equal(quota.usedBytes, bytes.length);
    await files.deleteWorkspaceFile(actor, created.id);
    await assert.rejects(files.getWorkspaceFile(actor, created.id), { status: 404 });
    const { driveLedger } = await import('../lib/rodrigo/drive-client');
    const ledger = await driveLedger(actor, 10);
    assert.equal(ledger[0].status, 'deleted', 'ledger row kept after deletion');
    // Another workspace cannot see it; a non-member is refused by Rodrigo.
    const other = await store.resolveLoginSession(login());
    await assert.rejects(files.getWorkspaceFile({ userId: other.user.id, workspaceId: other.workspace.id }, created.id), { status: 404 });
    await assert.rejects(files.listWorkspaceFiles({ userId: other.user.id, workspaceId: session.workspace.id }), { status: 403 });
  });

  test('edge policy and integrity: blocked type, damaged bytes, Tasks photo cap', async () => {
    const store = await import('../lib/store');
    const files = await import('../lib/files');
    const user = login();
    const session = await store.resolveLoginSession(user);
    const actor = { userId: user.id, workspaceId: session.workspace.id };
    await assert.rejects(files.createWorkspaceFile({ workspaceId: session.workspace.id, uploader: { userId: user.id }, displayName: 'x.exe', bytes: Buffer.from('MZ....') }), { status: 400 });
    const bytes = pngBytes(1000);
    await assert.rejects(
      files.createWorkspaceFile({ workspaceId: session.workspace.id, uploader: { userId: user.id }, displayName: 'b.png', bytes, expectedSha256: sha256('other') }),
      (error: unknown) => error instanceof files.FileAccessError && error.code === 'checksum_mismatch' && error.status === 422,
    );
    assert.equal((await files.listWorkspaceFiles(actor)).length, 0, 'damaged upload not visible');
    const ok = await files.createWorkspaceFile({ workspaceId: session.workspace.id, uploader: { userId: user.id }, displayName: 'c.png', bytes, sourceAppId: 'tasks' });
    assert.equal(ok.sourceAppId, 'tasks');
  });

  test('own storage: customer bucket and database as targets, in_use rules, eligibility', async () => {
    const store = await import('../lib/store');
    const files = await import('../lib/files');
    const own = await import('../lib/upload-storage/service');
    const user = login();
    let session = await store.resolveLoginSession(user);
    const actor = { userId: user.id, workspaceId: session.workspace.id };
    const driveInput = {
      provider: 's3-compatible', bucket: 'rodrigo-test', region: 'us-east-1', endpoint: process.env.RODRIGO_TEST_S3_ENDPOINT,
      pathStyle: true, prefix: `customer-${randomUUID().slice(0, 6)}/`, accessKeyId: 'test-access', secretAccessKey: 'test-secret-only', limitGb: 1,
    };
    assert.deepEqual(await own.ownStorageResult(session, () => own.connectDrive(session, driveInput)), { ok: false, code: 'not_eligible' });
    await store.setWorkspaceTier(session.workspace.id, 'pro');
    session = (await store.getHubSession(user.id))!;
    const connected = await own.ownStorageResult(session, () => own.connectDrive(session, driveInput));
    assert.equal(connected.ok, true, JSON.stringify(connected));
    if (!connected.ok) return;
    assert.equal(connected.snapshot.drive?.status, 'connected');
    assert.equal(connected.snapshot.drive?.accessKeyHint, 'cess');
    assert.ok(!JSON.stringify(connected.snapshot).includes('test-secret-only'), 'no secret in snapshot');
    assert.equal((await own.ownStorageResult(session, () => own.setTarget(session, 'drive'))).ok, true);
    const bytes = pngBytes(9 * MiB);
    const file = await files.createWorkspaceFile({ workspaceId: session.workspace.id, uploader: { userId: user.id }, displayName: 'own.png', bytes });
    assert.equal(file.storedIn, 'drive');
    assert.equal(sha256((await files.readWorkspaceFileBytes(actor, file.id)).bytes), sha256(bytes));
    assert.deepEqual(await own.ownStorageResult(session, () => own.disconnect(session, 'drive')), { ok: false, code: 'in_use' });
    // Customer database as the target (the test PostgreSQL stands in for it).
    const pg = new URL(process.env.RODRIGO_TEST_POSTGRES_URL!);
    const databaseInput = { host: pg.hostname === '127.0.0.1' ? 'localhost' : pg.hostname, port: Number(pg.port), database: pg.pathname.slice(1), user: decodeURIComponent(pg.username),
      password: decodeURIComponent(pg.password), schema: `cust_${randomUUID().slice(0, 6)}`, tls: 'disable', limitGb: 1 };
    const db = await own.ownStorageResult(session, () => own.connectDatabase(session, databaseInput));
    assert.equal(db.ok, true, JSON.stringify(db));
    assert.equal((await own.ownStorageResult(session, () => own.setTarget(session, 'database'))).ok, true);
    const small = pngBytes(2 * MiB + 3);
    const dbFile = await files.createWorkspaceFile({ workspaceId: session.workspace.id, uploader: { userId: user.id }, displayName: 'db.png', bytes: small });
    assert.equal(dbFile.storedIn, 'database');
    assert.equal(sha256((await files.readWorkspaceFileBytes(actor, dbFile.id)).bytes), sha256(small));
    await files.deleteWorkspaceFile(actor, dbFile.id);
    await files.deleteWorkspaceFile(actor, file.id);
    assert.equal((await own.ownStorageResult(session, () => own.setTarget(session, 'sorye'))).ok, true);
    assert.equal((await own.ownStorageResult(session, () => own.disconnect(session, 'drive'))).ok, true);
    // Losing the plan: uploads to own storage are refused, never silently sent elsewhere.
    assert.equal((await own.ownStorageResult(session, () => own.setTarget(session, 'database'))).ok, true);
    await store.setWorkspaceTier(session.workspace.id, 'free');
    await assert.rejects(files.createWorkspaceFile({ workspaceId: session.workspace.id, uploader: { userId: user.id }, displayName: 'no.png', bytes: small }), { status: 403 });
    const snapshot = await own.getOwnStorageSnapshot((await store.getHubSession(user.id))!);
    assert.ok(snapshot.recentUploads.some((u) => u.errorCode === 'not_eligible'), 'refusal recorded in the ledger');
  });

  test('64 MiB Drive upload through multipart: bounded Hub memory', async () => {
    const store = await import('../lib/store');
    const files = await import('../lib/files');
    const { parseMultipartUpload } = await import('../lib/multipart-stream');
    const user = login();
    const session = await store.resolveLoginSession(user);
    // A lazily generated multipart body: nothing in the test holds the 64 MiB.
    const size = 64 * MiB;
    const block = pngBytes(256 * 1024);
    const chunkOf = (offset: number) => (offset === 0 ? block : Buffer.alloc(Math.min(block.length, size - offset), 7));
    const hash = createHash('sha256');
    for (let offset = 0; offset < size; offset += block.length) hash.update(chunkOf(offset));
    const digest = hash.digest('hex');
    const boundary = 'testboundary12345';
    const enc = new TextEncoder();
    let offset = -1;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === -1) {
          controller.enqueue(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="sha256"\r\n\r\n${digest}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.png"\r\nContent-Type: image/png\r\n\r\n`));
          offset = 0;
        } else if (offset < size) {
          controller.enqueue(chunkOf(offset));
          offset += block.length;
        } else {
          controller.enqueue(enc.encode(`\r\n--${boundary}--\r\n`));
          controller.close();
        }
      },
    });
    const req = new Request('http://hub.test/api/files', { method: 'POST', body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, duplex: 'half' } as RequestInit);
    global.gc?.();
    const base = process.memoryUsage().arrayBuffers;
    let peak = base;
    const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().arrayBuffers); }, 10);
    const started = performance.now();
    const upload = await parseMultipartUpload(req.body!, req.headers.get('content-type'));
    const file = await files.createWorkspaceFileFromStream({
      workspaceId: session.workspace.id, uploader: { userId: user.id }, displayName: upload.fileName, source: upload.file,
      maxBytes: 64 * MiB, expectedSha256: upload.fields.get('sha256'),
    });
    clearInterval(sampler);
    const ms = performance.now() - started;
    assert.equal(file.size, size);
    assert.equal(file.sha256, digest);
    console.log(`[measure] Drive 64 MiB multipart upload ${ms.toFixed(0)} ms (${(64 / (ms / 1000)).toFixed(1)} MiB/s), Buffer growth during upload ${((peak - base) / MiB).toFixed(1)} MiB`);
    assert.ok((peak - base) / MiB < 48, 'Hub must not buffer the whole file');
  });

  test('storage down: Drive uploads fail closed and nothing becomes visible', { skip: !process.env.RODRIGO_TEST_S3_CONTAINER }, async () => {
    const store = await import('../lib/store');
    const files = await import('../lib/files');
    const user = login();
    const session = await store.resolveLoginSession(user);
    const actor = { userId: user.id, workspaceId: session.workspace.id };
    await docker('stop', process.env.RODRIGO_TEST_S3_CONTAINER!);
    try {
      await assert.rejects(files.createWorkspaceFile({ workspaceId: session.workspace.id, uploader: { userId: user.id }, displayName: 'down.png', bytes: pngBytes(1000) }), { status: 503 });
    } finally {
      await docker('start', process.env.RODRIGO_TEST_S3_CONTAINER!);
    }
    for (let i = 0; i < 60 && !(await fetch(`${rodrigo.origin}/health/ready`).then((r) => r.ok, () => false)); i += 1) await new Promise((r) => setTimeout(r, 500));
    assert.equal((await files.listWorkspaceFiles(actor)).length, 0);
  });
});
