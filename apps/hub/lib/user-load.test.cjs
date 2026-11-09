// Run from the repository root: node --test apps/hub/lib/user-load.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file) {
  const filename = path.resolve(file);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => {
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), name);
      return load(fs.existsSync(`${base}.ts`) ? `${base}.ts` : base);
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}

const { partitionUserLoad, mergeUserLoad, applyPersonalPackageGate } = load(path.join(__dirname, 'user-load.ts'));
const { mentionSuggestions, pingsToNotify, allowMessengerPing } = load(
  path.join(__dirname, '../../../packages/types/src/messenger.ts'),
);
const { APP_CATALOG, withAlwaysAvailableAppIds } = load(
  path.join(__dirname, '../../../packages/types/src/apps.ts'),
);

function packageIncludes(selectedAppIds, appId) {
  return withAlwaysAvailableAppIds(APP_CATALOG, selectedAppIds).includes(appId);
}

const personal = { id: 'ws-personal', name: 'Personal', kind: 'personal' };
const team = { id: 'ws-team', name: 'Moi team', kind: 'team' };
const otherPersonal = { id: 'ws-other', name: 'Other personal', kind: 'personal' };

test('a member of Personal and one team sees each item only on its side', () => {
  const split = partitionUserLoad('user-1', [personal, team], [
    { workspaceId: personal.id, value: { kind: 'channel', name: 'home' } },
    { workspaceId: personal.id, value: { kind: 'event', title: 'personal day' } },
    { workspaceId: team.id, value: { kind: 'note', title: 'team note' } },
    {
      workspaceId: team.id,
      value: { kind: 'channel', name: 'closed' },
      audienceIds: ['someone-else'],
    },
    { workspaceId: otherPersonal.id, value: { kind: 'note', title: 'not mine' } },
  ]);

  const personalValues = split.personal.flatMap((group) => group.items.map((item) => item.value));
  const workValues = split.work.flatMap((group) => group.items.map((item) => item.value));
  assert.deepEqual(personalValues.map((value) => value.kind), ['channel', 'event']);
  assert.deepEqual(workValues.map((value) => value.title), ['team note']);
  assert.equal(split.personal[0].items[0].workspaceName, 'Personal');
  assert.equal(split.personal[0].items[0].workspaceKind, 'personal');
  assert.equal(split.work[0].workspace.name, 'Moi team');
  assert.equal(JSON.stringify(split).includes('not mine'), false);
  assert.equal(JSON.stringify(split).includes('closed'), false);
});

test('a team-only member does not receive another personal workspace', () => {
  const split = partitionUserLoad('user-2', [team], [
    { workspaceId: otherPersonal.id, value: { title: 'private' } },
    { workspaceId: team.id, value: { title: 'shared' }, audienceIds: ['user-2'] },
    { workspaceId: team.id, value: { title: 'not invited' }, audienceIds: ['user-1'] },
  ]);
  assert.deepEqual(split.personal, []);
  assert.deepEqual(split.work.map((group) => group.items.map((item) => item.value.title)), [['shared']]);
});

test('a personal package that omits Notes drops personal rows and keeps team rows', () => {
  const split = partitionUserLoad('user-1', [personal, team], [
    { workspaceId: personal.id, value: { title: 'personal note' } },
    { workspaceId: team.id, value: { title: 'team note' } },
  ]);
  assert.equal(packageIncludes(['calendar'], 'notes'), false);
  assert.equal(packageIncludes(['notes'], 'notes'), true);
  assert.equal(packageIncludes([], 'catalog'), true);

  const hidden = applyPersonalPackageGate(split, packageIncludes(['calendar'], 'notes'));
  assert.deepEqual(hidden.personal, []);
  assert.deepEqual(hidden.work.map((group) => group.items.map((item) => item.value.title)), [['team note']]);

  const shown = applyPersonalPackageGate(split, packageIncludes(['notes'], 'notes'));
  assert.deepEqual(shown.personal.flatMap((group) => group.items.map((item) => item.value.title)), ['personal note']);
  assert.deepEqual(shown.work.flatMap((group) => group.items.map((item) => item.value.title)), ['team note']);
});

test('mention query stays in the channel workspace and personal pings follow the package', () => {
  const workspaceMembers = [
    { id: 'me', displayName: 'Alex Admin' },
    { id: 'ada', displayName: 'Ada Lovelace' },
    { id: 'beau', displayName: 'Beau Team' },
  ];
  const suggestions = mentionSuggestions({
    members: workspaceMembers,
    channelMemberIds: [],
    channelKind: 'channel',
    selfId: 'me',
    query: 'ada',
    allowed: (id) => allowMessengerPing('personal', id === 'ada'),
  });
  assert.deepEqual(suggestions.map((member) => member.id), ['ada']);

  const otherWorkspaceAbsent = mentionSuggestions({
    members: workspaceMembers,
    channelMemberIds: [],
    channelKind: 'channel',
    selfId: 'me',
    query: 'outsider',
  });
  assert.deepEqual(otherWorkspaceAbsent, []);

  const personalNotify = pingsToNotify({
    requestedIds: ['ada', 'beau', 'outsider', 'me'],
    members: workspaceMembers,
    channelMemberIds: [],
    channelKind: 'channel',
    authorId: 'me',
    allowed: (id) => allowMessengerPing('personal', id === 'ada'),
  });
  assert.deepEqual(personalNotify, ['ada']);

  const workNotify = pingsToNotify({
    requestedIds: ['ada', 'beau', 'outsider'],
    members: workspaceMembers.filter((member) => member.id !== 'ada'),
    channelMemberIds: [],
    channelKind: 'channel',
    authorId: 'me',
    allowed: (id) => allowMessengerPing('team', false),
  });
  assert.deepEqual(workNotify, ['beau']);
});

test('mergeUserLoad orders personal then teams and is not referenced by UI modules', () => {
  const split = partitionUserLoad('user-1', [
    { id: 't2', name: 'Zeta', kind: 'team' },
    personal,
    { id: 't1', name: 'Alpha', kind: 'team' },
  ], [
    { workspaceId: 't2', value: 'z' },
    { workspaceId: personal.id, value: 'p' },
    { workspaceId: 't1', value: 'a' },
  ]);
  assert.deepEqual(mergeUserLoad(split).map((item) => item.value), ['p', 'a', 'z']);

  const allowed = new Set([
    path.normalize(path.join(__dirname, 'user-load.ts')),
    path.normalize(path.join(__dirname, 'user-load.test.cjs')),
  ]);
  const hits = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(tsx|jsx|ts|js|cjs|mjs)$/.test(entry.name)) continue;
      if (allowed.has(path.normalize(full))) continue;
      if (fs.readFileSync(full, 'utf8').includes('mergeUserLoad')) hits.push(full);
    }
  }
  walk(path.join(__dirname, '../../../apps'));
  walk(path.join(__dirname, '../../../packages'));
  assert.deepEqual(hits, []);
});
