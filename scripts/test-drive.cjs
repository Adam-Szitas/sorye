// Isolated storage + Relay integration; no credentials or workspace data used.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sorye-drive-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const stores = new Map();
const cache = new Map();
const mocks = {
  '@/lib/store/json-file': { jsonDataFile(name, init) {
    if (!stores.has(name)) stores.set(name, init());
    return { read: async () => stores.get(name), update: async (fn) => fn(stores.get(name)) };
  } },
  '@/lib/security': {},
  '@/lib/store/messenger': {},
};
function load(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const localRequire = (name) => {
    if (name in mocks) return mocks[name];
    if (name === '@sorye/types') return load('packages/types/src/index.ts');
    if (name.startsWith('@/')) return load(`apps/hub/${name.slice(2)}.ts`);
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`));
    return require(name);
  };
  new Function('require', 'module', 'exports', 'process', code)(localRequire, module, module.exports, { cwd: () => root });
  return module.exports;
}
const files = load('apps/hub/lib/files.ts');
const relay = load('apps/hub/lib/relay.ts');
const handoffs = load('apps/hub/lib/handoffs.ts');

test('app folders, rename, Relay open, isolation and delete preserve one original', async () => {
  const bytes = Buffer.from('%PDF-1.7\noriginal document');
  const file = await files.createWorkspaceFile({ workspaceId: 'test-a', sourceAppId: 'ocr', displayName: 'original.pdf', bytes });
  assert.equal(file.sourceAppId, 'ocr');
  await files.renameWorkspaceFile('test-a', file.id, 'renamed.pdf');
  const handoff = await relay.relayFileToApp('test-a', file.id, 'ocr');
  assert.equal(handoff.title, 'renamed.pdf');
  assert.equal(handoff.kind, 'workspace-file');
  assert.deepEqual(handoff.payload, { fileId: file.id });
  assert.equal((await handoffs.getHandoff('test-b', handoff.id)), null);
  assert.equal((await relay.getRelayConfig('test-a')).messages[0].deliveries[0].channelKind, 'app');
  assert.equal((await files.listWorkspaceFiles('test-a')).length, 1);
  assert.deepEqual((await files.readWorkspaceFileBytes('test-a', file.id)).bytes, bytes);
  await assert.rejects(files.readWorkspaceFileBytes('test-b', file.id), { status: 404 });
  await assert.rejects(relay.relayFileToApp('test-b', file.id, 'ocr'), { status: 404 });
  await assert.rejects(relay.relayFileToApp('test-a', file.id, 'studio'), { status: 400 });
  await files.deleteWorkspaceFile('test-a', file.id);
  assert.equal((await files.listWorkspaceFiles('test-a')).length, 0);
  await assert.rejects(files.readWorkspaceFileBytes('test-a', file.id), { status: 404 });
  assert.equal(fs.existsSync(path.join(root, '.data/files', 'test-a', file.id)), false);
});

test('invalid app, unsafe bytes and unsupported OCR inputs are rejected', async () => {
  await assert.rejects(files.createWorkspaceFile({ workspaceId: 'test-a', sourceAppId: '../bad', displayName: 'x.txt', bytes: Buffer.from('hello') }), { status: 400 });
  await assert.rejects(files.createWorkspaceFile({ workspaceId: 'test-a', sourceAppId: 'studio', displayName: 'x.stl', bytes: Buffer.from('MZ executable') }), { status: 400 });
  const text = await files.createWorkspaceFile({ workspaceId: 'test-a', displayName: 'x.txt', bytes: Buffer.from('hello') });
  assert.equal(text.sourceAppId, 'files');
  await assert.rejects(relay.relayFileToApp('test-a', text.id, 'ocr'), { status: 400 });
  const mesh = await files.createWorkspaceFile({ workspaceId: 'test-a', sourceAppId: 'studio', displayName: 'mesh.obj', bytes: Buffer.from('v 0 0 0') });
  assert.equal(mesh.mime, 'application/octet-stream');
  assert.deepEqual(load('packages/types/src/files.ts').fileOpenAppIds(mesh.mime), []);
});
