const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the production route with only its session/store/network boundaries replaced.
const source = readFileSync(join(__dirname, '../app/api/workspace/route.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
function route({ session = { user: { id: 'user-a' }, workspace: { id: 'workspace-a' } }, result = { saved: true } } = {}) {
  const writes = [];
  const exports = {};
  const dependencies = {
    '@/lib/ensure-user': { ensureHubUser: async () => session },
    '@/lib/personal-package': {},
    '@/lib/store': { updateWorkspace: async (...args) => { writes.push(args); return result; } },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/server-timing': {},
    '@/lib/rodrigo/service-client': {},
  };
  vm.runInNewContext(compiled, { exports, require: (id) => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected dependency: ${id}`);
    return dependencies[id];
  } });
  return { writes, patch: (body) => exports.PATCH(new Request('http://localhost/api/workspace', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })) };
}
const connection = { id: 'connection-a', name: 'My service', endpoint: 'https://service.example/api',
  apiKeyHint: '****1234', scopes: ['read'], status: 'pending', connectedAt: '2026-11-11T12:00:00Z' };

test('connecting an app requires an authenticated Hub session', async () => {
  const r = route({ session: null });
  assert.equal((await r.patch({ connectedApps: [connection] })).status, 401);
  assert.equal(r.writes.length, 0);
});
test('connection save targets the authenticated user and active workspace', async () => {
  const r = route();
  const response = await r.patch({ connectedApps: [connection], workspaceId: 'victim', userId: 'victim' });
  assert.equal(response.status, 200);
  assert.equal(r.writes[0][0], 'user-a');
  assert.equal(r.writes[0][1], 'workspace-a');
  assert.deepEqual(r.writes[0][2].connectedApps, [connection]);
});
test('disconnect forwards the remaining connections and preserves them', async () => {
  const remaining = { ...connection, id: 'connection-b' };
  const r = route();
  assert.equal((await r.patch({ connectedApps: [remaining] })).status, 200);
  assert.deepEqual(r.writes[0][2].connectedApps, [remaining]);
  assert.equal((await r.patch({ connectedApps: [] })).status, 200);
  assert.deepEqual(r.writes[1][2].connectedApps, []);
});
test('store rejection is returned as a failed connection update', async () => {
  const r = route({ result: null });
  const response = await r.patch({ connectedApps: [connection] });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Update failed');
});
test('connection patch cannot also use the disabled workspace profile writer', async () => {
  const r = route();
  assert.equal((await r.patch({ name: 'Changed', connectedApps: [connection] })).status, 410);
  assert.equal(r.writes.length, 0);
});
test('KNOWN GAP: route accepts client-asserted active status without service verification', async () => {
  const r = route();
  assert.equal((await r.patch({ connectedApps: [{ ...connection, status: 'active' }] })).status, 200);
  assert.equal(r.writes[0][2].connectedApps[0].status, 'active');
});
test('KNOWN GAP: route forwards malformed connection data without validation', async () => {
  const r = route();
  assert.equal((await r.patch({ connectedApps: 'invalid' })).status, 200);
  assert.equal(r.writes[0][2].connectedApps, 'invalid');
});
