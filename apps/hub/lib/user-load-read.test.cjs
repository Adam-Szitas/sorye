// Run from the repository root: node --test apps/hub/lib/user-load-read.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const typesIndex = path.join(__dirname, '../../../packages/types/src/index.ts');

/** Load `user-load-read.ts` with the store replaced by `store`. */
function loadWithStore(store) {
  const cache = new Map();
  const load = (file) => {
    const filename = path.resolve(file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = (name) => {
      if (name === '@/lib/store') return store;
      if (name === '@sorye/types') return load(typesIndex);
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(filename), name);
        if (fs.existsSync(`${base}.ts`)) return load(`${base}.ts`);
        if (fs.existsSync(path.join(base, 'index.ts'))) return load(path.join(base, 'index.ts'));
        return load(base);
      }
      return require(name);
    };
    new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
    return module.exports;
  };
  return load(path.join(__dirname, 'user-load-read.ts'));
}

const USER = 'user-1';
const personal = { id: 'ws-personal', name: 'Personal', kind: 'personal' };
const teamA = { id: 'ws-team-a', name: 'Team A', kind: 'team' };
const teamB = { id: 'ws-team-b', name: 'Team B', kind: 'team' };

function storedSession(userId, workspace, overrides = {}) {
  return {
    user: { id: userId, personalWorkspaceId: personal.id, activeWorkspaceId: workspace.id },
    workspace: { ...workspace, memberIds: [userId], selectedAppIds: ['tasks'], ...overrides },
    workspaces: [personal, teamA, teamB],
  };
}

/** A store that answers after a tick and records how many checks overlap. */
function fakeStore(answers) {
  const calls = [];
  let inFlight = 0;
  let peak = 0;
  return {
    calls,
    peak: () => peak,
    async getHubSessionForWorkspace(userId, workspaceId) {
      calls.push([userId, workspaceId]);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const answer = answers[workspaceId];
      return typeof answer === 'function' ? answer(userId) : answer ?? null;
    },
    async getHubSession() {
      return null;
    },
  };
}

function viewerSession(workspaces, active = personal) {
  return {
    user: { id: USER, personalWorkspaceId: personal.id, activeWorkspaceId: active.id },
    workspace: { ...active, memberIds: [USER], selectedAppIds: ['tasks'] },
    workspaces,
  };
}

test('member scopes keep session order and are checked together, once per workspace', async () => {
  const store = fakeStore({
    [personal.id]: storedSession(USER, personal),
    [teamA.id]: storedSession(USER, teamA),
    [teamB.id]: storedSession(USER, teamB),
  });
  const { memberScopes } = loadWithStore(store);

  const scopes = await memberScopes(viewerSession([personal, teamA, teamB, teamA]));

  assert.deepEqual(scopes, [personal, teamA, teamB]);
  assert.deepEqual(store.calls, [[USER, personal.id], [USER, teamA.id], [USER, teamB.id]]);
  assert.equal(store.peak(), 3, 'the three membership checks should overlap');
});

test('a workspace the store does not confirm is never a scope', async () => {
  const store = fakeStore({
    [personal.id]: storedSession(USER, personal),
    // Listed in the session, but the store says the user is not a member.
    [teamA.id]: null,
    // The store answers for a different workspace than the one asked about.
    [teamB.id]: storedSession(USER, teamA),
  });
  const { memberScopes } = loadWithStore(store);

  assert.deepEqual(await memberScopes(viewerSession([personal, teamA, teamB])), [personal]);
});

test('a session for another user or without the member is rejected', async () => {
  const store = fakeStore({
    [personal.id]: storedSession(USER, personal),
    [teamA.id]: storedSession('someone-else', teamA),
    [teamB.id]: storedSession(USER, teamB, { memberIds: ['someone-else'] }),
  });
  const { memberScopes } = loadWithStore(store);

  assert.deepEqual(await memberScopes(viewerSession([personal, teamA, teamB])), [personal]);
});

test('a partitioned read never reads a workspace that failed the membership check', async () => {
  const store = fakeStore({
    [personal.id]: storedSession(USER, personal),
    [teamA.id]: storedSession(USER, teamA),
    [teamB.id]: null,
  });
  const { readPartitionedLoad } = loadWithStore(store);
  const read = [];

  const partition = await readPartitionedLoad(
    viewerSession([personal, teamA, teamB]),
    async (scope) => {
      read.push(scope.id);
      return [{ workspaceId: scope.id, value: { id: `item-${scope.id}` } }];
    },
    { appId: 'tasks' },
  );

  assert.deepEqual(read.sort(), [personal.id, teamA.id]);
  const seen = [...partition.personal, ...partition.work].flatMap((group) => group.items.map((item) => item.value.id));
  assert.deepEqual(seen.sort(), [`item-${personal.id}`, `item-${teamA.id}`]);
});
