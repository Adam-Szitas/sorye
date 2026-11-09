// Run from the repository root: node --test apps/hub/lib/operator/operator.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const cache = new Map();

function load(file, mocks = {}) {
  const filename = path.resolve(file);
  if (cache.has(filename)) return cache.get(filename);
  const input = fs.readFileSync(filename, 'utf8');
  const source = ts.transpileModule(input, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  cache.set(filename, module.exports);
  const localRequire = (name) => {
    if (name === '@/lib/platform-admin') {
      return load(path.join(__dirname, '../platform-admin.ts'), mocks);
    }
    if (name === '@/lib/env') {
      return { getAdminEmails: () => mocks.adminEmails ?? new Set() };
    }
    if (name === '@/lib/security') {
      return {
        emailInAdminList(email, list) {
          const needle = String(email ?? '').trim().toLowerCase();
          for (const admin of list) {
            if (String(admin).trim().toLowerCase() === needle) return true;
          }
          return false;
        },
      };
    }
    if (name === '@sorye/types') return typesFacade();
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), name);
      const resolved = fs.existsSync(`${base}.ts`) ? `${base}.ts` : base;
      return load(resolved, mocks);
    }
    return require(name);
  };
  new Function('require', 'module', 'exports', source)(localRequire, module, module.exports);
  return module.exports;
}

function typesFacade() {
  const root = path.join(__dirname, '../../../../packages/types/src');
  const subscription = load(path.join(root, 'subscription.ts'));
  const workspace = load(path.join(root, 'workspace.ts'));
  return { ...subscription, ...workspace };
}

const mocks = { adminEmails: new Set(['operator@example.com']) };
const { operatorDenial } = load(path.join(__dirname, 'access.ts'), mocks);
const { assignPlanInWorkspaceMap } = load(path.join(__dirname, 'plan-record.ts'));
const { noticeVisibleTo } = load(path.join(__dirname, 'notices-match.ts'));
const sink = load(path.join(__dirname, 'sink.ts'));

function workspace(id, subscriptionId, selectedAppIds) {
  return {
    id,
    kind: 'personal',
    name: 'North',
    ownerId: 'user-1',
    memberIds: ['user-1'],
    subscriptionId,
    subscriptionSource: 'stripe',
    selectedAppIds,
    connectedApps: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('non-admin receives 403 and no operator payload', () => {
  const denied = operatorDenial({ email: 'member@example.com', isAdmin: true });
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { error: 'Forbidden' });
  assert.deepEqual(Object.keys(denied.body), ['error']);
  assert.equal(operatorDenial(null).status, 401);
  assert.equal(operatorDenial({ email: 'operator@example.com', isAdmin: false }), null);
  mocks.adminEmails = new Set();
  assert.equal(operatorDenial({ email: 'member@example.com', isAdmin: false }).status, 403);
  assert.equal(operatorDenial({ email: 'member@example.com', isAdmin: true }), null);
  mocks.adminEmails = new Set(['operator@example.com']);
});

test('setting a plan updates the workspace store and ignores an unknown workspace', () => {
  const store = {
    'ws-1': workspace('ws-1', 'free', ['notes', 'calendar', 'tasks', 'mail']),
  };
  const updated = assignPlanInWorkspaceMap(store, 'ws-1', 'pro');
  assert.equal(updated.subscriptionId, 'pro');
  assert.equal(store['ws-1'].subscriptionId, 'pro');
  assert.equal(store['ws-1'].subscriptionSource, 'admin');
  assert.equal(store['ws-1'].id, 'ws-1');
  assert.equal(assignPlanInWorkspaceMap(store, 'missing', 'enterprise'), null);
  assert.equal(store.missing, undefined);
});

test('a scheduled Pro notice is visible to Pro inside the window only', () => {
  const notice = {
    active: true,
    audience: 'pro',
    startsAt: '2026-09-01T00:00:00.000Z',
    endsAt: '2026-09-30T00:00:00.000Z',
  };
  const inside = Date.parse('2026-09-15T12:00:00.000Z');
  const before = Date.parse('2026-08-15T12:00:00.000Z');
  assert.equal(noticeVisibleTo(notice, { plan: 'pro', now: inside, dismissed: false }), true);
  assert.equal(noticeVisibleTo(notice, { plan: 'free', now: inside, dismissed: false }), false);
  assert.equal(noticeVisibleTo(notice, { plan: 'starter', now: inside, dismissed: false }), false);
  assert.equal(noticeVisibleTo(notice, { plan: 'enterprise', now: inside, dismissed: false }), false);
  assert.equal(noticeVisibleTo(notice, { plan: 'pro', now: before, dismissed: false }), false);
  assert.equal(noticeVisibleTo({ ...notice, active: false }, { plan: 'pro', now: inside, dismissed: false }), false);
});

test('a recorded error stores the message and not a document body or prompt', () => {
  sink.configureOperatorSinkForTests({ persist: async () => {} });
  const documentBody = 'Invoice total 96 491,29 for ACME concrete delivery on page 4 of the uploaded PDF';
  const prompt = 'You are a careful extraction model. Return JSON for the invoice tables and line items.';
  sink.noteOperatorError({
    appId: 'ocr',
    route: 'worker:ocr?debug=1',
    message: `parse failed ${documentBody} ${prompt}`,
    stack: 'Error: parse failed\n    at apps/hub/lib/ocr/analyze.ts:88:3\n    at internal',
    redact: [documentBody, prompt],
  });
  const [stored] = sink.readOperatorErrorsForTests();
  assert.match(stored.message, /parse failed/);
  assert.equal(stored.message.includes('96 491,29'), false);
  assert.equal(stored.message.includes('extraction model'), false);
  assert.equal(JSON.stringify(stored).includes('ACME concrete'), false);
  assert.equal(stored.appId, 'ocr');
  assert.equal(stored.route, 'worker:ocr');
  assert.equal(stored.location, 'apps/hub/lib/ocr/analyze.ts:88:3');
  assert.equal('prompt' in stored, false);
  assert.equal('document' in stored, false);
  assert.equal('body' in stored, false);
});

test('a metric write returns before a slow sink finishes', async () => {
  let started = false;
  let finished = false;
  sink.configureOperatorSinkForTests({
    persist: () => new Promise((resolve) => {
      started = true;
      setTimeout(() => {
        finished = true;
        resolve();
      }, 250);
    }),
  });
  const startedAt = Date.now();
  const result = sink.noteOperatorSample({
    at: Date.now(),
    appId: 'notes',
    workspaceId: 'ws-1',
    workspaceName: 'North',
    eventName: 'sorye.notes.saved',
    ok: true,
    kind: 'event',
  });
  assert.equal(result, undefined);
  assert.ok(Date.now() - startedAt < 50);
  assert.equal(finished, false);
  await sink.flushOperatorSinkForTests();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(started, true);
  assert.equal(finished, false);
});
