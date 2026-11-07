import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDefaultTasksBoard, type RodrigoSnapshot } from '@sorye/types';
import { createDocumentRouter, DocumentWritesFrozenError } from '../lib/rodrigo/document-router';
import { getDocumentOwner, parseDocumentOwners, DocumentOwnershipError, type DocumentOwnership } from '../lib/rodrigo/document-ownership';
import { importDocument, validateMigrationExport } from '../lib/rodrigo/document-migration';
import { WorkspaceDocConflict } from '../lib/store/workspace-doc-conflict';
import { getRodrigoSnapshot, putRodrigoDocument, deleteRodrigoDocument, RodrigoUnavailableError } from '../lib/rodrigo/service-client';

const payload = { board: createDefaultTasksBoard() };
function fixture() {
  let owner: DocumentOwnership = { workspaceId: 'w', kind: 'tasks', owner: 'rodrigo', revisionOffset: 12 };
  let allowed = true;
  let snapshot: RodrigoSnapshot = { revision: 1, document: { revision: 1, payload } };
  const calls = { legacy: 0, remote: 0, write: 0 };
  const router = createDocumentRouter({
    authorize: async () => allowed,
    owner: () => owner,
    legacyRead: async () => { calls.legacy++; return { access: 'ok', doc: { revision: 12, payload } }; },
    legacyWrite: async () => { calls.legacy++; return { revision: 13, payload }; },
    snapshot: async () => { calls.remote++; return snapshot; },
    write: async (_context, _kind, input) => {
      calls.write++;
      assert.equal(input.expectedRevision, snapshot.revision);
      return { revision: snapshot.revision + 1, payload: input.payload };
    },
  });
  return { router, calls, owner: (value: DocumentOwnership) => { owner = value; },
    allow: (value: boolean) => { allowed = value; }, snapshot: (value: RodrigoSnapshot) => { snapshot = value; } };
}

test('ownership is explicit, rejects duplicates and Notes, and fails closed after bad configuration', () => {
  assert.equal(parseDocumentOwners('[]').size, 0);
  for (const raw of ['bad', '[{"workspaceId":"w","kind":"notes","owner":"frozen"}]',
    JSON.stringify(Array(2).fill({ workspaceId: 'w', kind: 'tasks', owner: 'frozen' }))]) {
    assert.throws(() => parseDocumentOwners(raw), DocumentOwnershipError);
  }
  const saved = process.env.RODRIGO_DOCUMENT_OWNERS;
  try {
    process.env.RODRIGO_DOCUMENT_OWNERS = '[{"workspaceId":"w","kind":"tasks","owner":"frozen"}]';
    assert.equal(getDocumentOwner('w', 'tasks').owner, 'frozen');
    assert.equal(getDocumentOwner('other', 'tasks').owner, 'hub');
    process.env.RODRIGO_DOCUMENT_OWNERS = '{';
    assert.throws(() => getDocumentOwner('w', 'tasks'), DocumentOwnershipError);
  } finally {
    if (saved === undefined) delete process.env.RODRIGO_DOCUMENT_OWNERS;
    else process.env.RODRIGO_DOCUMENT_OWNERS = saved;
  }
});

test('denied authorization prevents reads and writes to either owner', async () => {
  const f = fixture(); f.allow(false);
  assert.deepEqual(await f.router.read('u', 'w', 'tasks'), { access: 'denied' });
  assert.equal(await f.router.write('u', 'w', 'tasks', payload, { expectedRevision: 13 }), null);
  assert.deepEqual(f.calls, { legacy: 0, remote: 0, write: 0 });
});

test('freeze permits source reads, blocks writes and does not touch Rodrigo', async () => {
  const f = fixture(); f.owner({ workspaceId: 'w', kind: 'tasks', owner: 'frozen' });
  await f.router.read('u', 'w', 'tasks');
  await assert.rejects(() => f.router.write('u', 'w', 'tasks', payload), DocumentWritesFrozenError);
  assert.deepEqual(f.calls, { legacy: 1, remote: 0, write: 0 });
});

test('imported revisions and tombstones stay monotonic; deleted records cannot be resurrected by legacy imports', async () => {
  const f = fixture();
  assert.deepEqual(await f.router.read('u', 'w', 'tasks'), { access: 'ok', revision: 13, doc: { revision: 13, payload } });
  assert.equal((await f.router.write('u', 'w', 'tasks', payload, { expectedRevision: 13 }))?.revision, 14);
  f.snapshot({ revision: 4, document: null });
  assert.deepEqual(await f.router.read('u', 'w', 'tasks'), { access: 'ok', revision: 16, doc: null });
  await assert.rejects(() => f.router.write('u', 'w', 'tasks', payload, { migrate: true }), WorkspaceDocConflict);
  assert.equal((await f.router.write('u', 'w', 'tasks', payload, { expectedRevision: 16 }))?.revision, 17);
  f.snapshot({ revision: 0, document: null });
  await assert.rejects(() => f.router.read('u', 'w', 'tasks'), DocumentOwnershipError);
  await assert.rejects(() => f.router.write('u', 'w', 'tasks', payload, { migrate: true }), DocumentOwnershipError);
  assert.equal(f.calls.legacy, 0);
});

test('migration dry run is read-only, verifies data and reconciles a previously committed import', async () => {
  const source = validateMigrationExport({ format: 'sorye-rodrigo-document-v1', userId: 'u', workspaceId: 'w', kind: 'tasks', document: { revision: 12, payload } });
  let snapshot: RodrigoSnapshot = { revision: 0, document: null };
  let writes = 0;
  const backend = {
    snapshot: async () => snapshot,
    write: async () => { writes++; snapshot = { revision: 1, document: { revision: 1, payload } }; return snapshot.document!; },
  };
  assert.equal((await importDocument(source, backend, false)).verified, false);
  assert.equal(writes, 0);
  const receipt = await importDocument(source, backend, true);
  assert.equal(receipt.verified, true);
  if (receipt.verified) assert.equal(receipt.browserRevision, 13);
  await importDocument(source, backend, true);
  assert.equal(writes, 1);
  snapshot = { revision: 2, document: null };
  await assert.rejects(() => importDocument(source, backend, true), /Target is not pristine/);
});

test('real PostgreSQL cutover: parity, concurrent writers, isolation, tombstones and service restart', {
  skip: !process.env.RODRIGO_TEST_POSTGRES_URL, timeout: 60000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sorye-document-cutover-'));
  const keys = generateKeyPairSync('ed25519');
  const publicKeys = join(directory, 'keys.json');
  const privateKeyFile = join(directory, 'private.pem');
  const providersFile = join(directory, 'providers.json');
  await writeFile(publicKeys, JSON.stringify({ test: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }));
  await writeFile(privateKeyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  await writeFile(providersFile, JSON.stringify({ allow_insecure_local: true, postgresql: process.env.RODRIGO_TEST_POSTGRES_URL, documents: { tasks: 'postgresql', calendar: 'postgresql' } }));
  const savedEnv = { ...process.env };
  let stop = async () => {};
  const start = async () => {
    const env = { ...savedEnv };
    for (const key of Object.keys(env)) if (key.startsWith('RODRIGO_')) delete env[key];
    const binary = savedEnv.RODRIGO_TEST_BINARY ?? resolve('../..', '../rodrigo/target/debug', process.platform === 'win32' ? 'rodrigo.exe' : 'rodrigo');
    const child = spawn(binary, [], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...env, RODRIGO_PUBLIC_KEYS_FILE: publicKeys, RODRIGO_PROVIDERS_FILE: providersFile,
      RODRIGO_LISTEN: '127.0.0.1:0', RODRIGO_METRICS_LISTEN: '127.0.0.1:0',
    } });
    const closed = once(child, 'close');
    // Handle a missing executable without leaving an unhandled rejection.
    void closed.catch(() => {});
    stop = async () => { child.kill(); await closed.catch(() => {}); };
    child.stderr.resume();
    const origin = await new Promise<string>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('Rodrigo startup timed out')), 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Rodrigo exited during startup')); });
      let buffer = '';
      child.stdout.on('data', (data: Buffer) => {
        buffer += data.toString();
        for (let index; (index = buffer.indexOf('\n')) >= 0;) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          try { const record = JSON.parse(line); if (record.fields?.api) { clearTimeout(timer); resolveReady(`http://${record.fields.api}`); } } catch {}
        }
      });
    });
    process.env.RODRIGO_BASE_URL = origin;
    process.env.RODRIGO_KEY_ID = 'test';
    process.env.RODRIGO_PRIVATE_KEY_FILE = privateKeyFile;
  };
  try {
    await start();
    const context = { userId: 'test-user', workspaceId: randomUUID() };
    const source = validateMigrationExport({ format: 'sorye-rodrigo-document-v1', ...context, kind: 'tasks', document: { revision: 12, payload } });
    const backend = { snapshot: getRodrigoSnapshot, write: putRodrigoDocument };
    const receipt = await importDocument(source, backend, true);
    assert.equal(receipt.verified, true);
    if (!receipt.verified) throw new Error('Import was not verified');
    let legacyCalls = 0;
    const router = createDocumentRouter({
      authorize: async ({ userId, workspaceId }, kind) => userId === context.userId && workspaceId === context.workspaceId && kind === 'tasks',
      owner: () => receipt.owner,
      legacyRead: async () => { legacyCalls++; throw new Error('Unexpected Hub fallback'); },
      legacyWrite: async () => { legacyCalls++; throw new Error('Unexpected Hub fallback'); },
      snapshot: getRodrigoSnapshot, write: putRodrigoDocument,
    });
    const read = () => router.read(context.userId, context.workspaceId, 'tasks');
    assert.deepEqual(await read(), { access: 'ok', revision: 13, doc: { revision: 13, payload } });
    await assert.rejects(() => router.write(context.userId, context.workspaceId, 'tasks', payload, { expectedRevision: 12 }), WorkspaceDocConflict);
    const results = await Promise.allSettled(Array.from({ length: 16 }, () => router.write(context.userId, context.workspaceId, 'tasks', payload, { expectedRevision: 13 })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    for (const result of results) if (result.status === 'rejected') assert.ok(result.reason instanceof WorkspaceDocConflict);
    assert.deepEqual(await router.read('outsider', context.workspaceId, 'tasks'), { access: 'denied' });
    assert.equal((await getRodrigoSnapshot({ ...context, workspaceId: randomUUID() }, 'tasks')).document, null);
    await deleteRodrigoDocument(context, 'tasks', { expectedRevision: 2 });
    assert.deepEqual(await read(), { access: 'ok', revision: 15, doc: null });
    await stop();
    await assert.rejects(read, RodrigoUnavailableError);
    await start();
    assert.deepEqual(await read(), { access: 'ok', revision: 15, doc: null });
    const restored = await router.write(context.userId, context.workspaceId, 'tasks', payload, { expectedRevision: 15 });
    assert.equal(restored?.revision, 16);
    assert.equal(legacyCalls, 0);

    // Exercise the actual operator command against isolated Hub JSON records.
    const cliWorkspace = randomUUID();
    await mkdir(join(directory, '.data'));
    await writeFile(join(directory, '.data/store.json'), JSON.stringify({
      users: { 'cli-user': { id: 'cli-user', activeWorkspaceId: cliWorkspace, personalWorkspaceId: cliWorkspace, teamWorkspaceIds: [] } },
      workspaces: { [cliWorkspace]: { id: cliWorkspace, kind: 'personal', name: 'CLI test', memberIds: ['cli-user'], selectedAppIds: ['tasks'] } },
    }));
    await writeFile(join(directory, '.data/workspace-docs.json'), JSON.stringify({ docs: {
      [`${cliWorkspace}:tasks`]: { workspaceId: cliWorkspace, kind: 'tasks', revision: 8, payload, updatedBy: 'cli-user', updatedAt: new Date().toISOString() },
    } }));
    const runCli = (args: string[]) => promisify(execFile)(process.execPath, [
      resolve('node_modules/tsx/dist/cli.mjs'), '--tsconfig', resolve('tsconfig.json'),
      resolve('lib/tools/migrate-rodrigo-document.ts'), ...args,
    ], { cwd: directory, windowsHide: true, timeout: 15000, env: {
      ...process.env, NODE_ENV: 'test', STORE_DRIVER: 'json', DATABASE_URL: '',
      AUTH_SECRET: 'test-only-auth-secret', ADMIN_SECRET: 'test-only-admin',
      RODRIGO_DOCUMENT_OWNERS: JSON.stringify([{ workspaceId: cliWorkspace, kind: 'tasks', owner: 'frozen' }]),
    } });
    const exportFile = join(directory, 'export.json');
    const receiptFile = join(directory, 'receipt.json');
    await assert.rejects(() => runCli(['export', '--user', 'outsider', '--workspace', cliWorkspace, '--kind', 'tasks', '--file', exportFile]), /workspace member/);
    await runCli(['export', '--user', 'cli-user', '--workspace', cliWorkspace, '--kind', 'tasks', '--file', exportFile]);
    await runCli(['import', '--file', exportFile]);
    assert.equal((await getRodrigoSnapshot({ userId: 'cli-user', workspaceId: cliWorkspace }, 'tasks')).revision, 0);
    await runCli(['import', '--file', exportFile, '--apply', '--writers-stopped', '--receipt', receiptFile]);
    const cliReceipt = JSON.parse(await readFile(receiptFile, 'utf8'));
    assert.equal(cliReceipt.browserRevision, 9);
    assert.equal(cliReceipt.owner.revisionOffset, 8);
  } finally {
    await stop();
    for (const key of ['RODRIGO_BASE_URL', 'RODRIGO_KEY_ID', 'RODRIGO_PRIVATE_KEY_FILE']) {
      if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
