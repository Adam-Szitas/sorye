// Run from the repository root: node --test apps/hub/lib/ocr/job-notify.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const files = new Map();
const analysisUpdates = [];

function jsonDataFile(name, fallback) {
  if (!files.has(name)) files.set(name, { scopes: new Map(), fallback });
  const slot = files.get(name);
  return {
    async read(scope = '@global') {
      if (!slot.scopes.has(scope)) slot.scopes.set(scope, slot.fallback());
      return slot.scopes.get(scope);
    },
    async update(fn, scope = '@global') {
      if (!slot.scopes.has(scope)) slot.scopes.set(scope, slot.fallback());
      return fn(slot.scopes.get(scope));
    },
  };
}

function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, file);
  const input = fs.readFileSync(filename, 'utf8');
  const source = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => {
    if (name in mocks) return mocks[name];
    if (name === '@/lib/store/json-file') return { jsonDataFile };
    if (name === '@/lib/messenger-unread') {
      return { countMessengerUnread: async () => 0, markMessengerRead: async () => {} };
    }
    if (name === '@/lib/store/ocr-analyses') return mocks.ocr;
    if (name === '@sorye/types') return load('../../../../packages/types/src/notifications.ts', mocks);
    if (name.startsWith('@/')) {
      const base = path.resolve(__dirname, '../../', name.slice(2));
      const resolved = fs.existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
      return load(resolved, mocks);
    }
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

const ocr = {
  async getOcrAnalysis() {
    return { access: 'ok', analysis: { status: 'extracting', pattern: null, error: null } };
  },
  async updateOcrAnalysis(userId, workspaceId, id, patch) {
    analysisUpdates.push({ userId, workspaceId, id, patch });
    return null;
  },
};

const { notifyFinishedBackgroundJob } = load('../job-finished.ts', { ocr });
const { getNotificationSnapshot } = load('../notifications.ts', { ocr });
const { chooseFromJob, chooseOcrResume } = load('../../../ocr/src/resume-target.ts');

const completed = {
  id: 'job-ocr-1',
  workspaceId: 'ws-a',
  userId: 'user-a',
  kind: 'ocr',
  status: 'completed',
  payload: { fileId: 'file-1', analysisId: 'ocr-finished' },
  result: { analysisId: 'ocr-finished', phase: 'complete' },
  error: null,
};

test('completing an OCR job notifies only that user and workspace and points at the analysis', async () => {
  await notifyFinishedBackgroundJob(completed);
  await notifyFinishedBackgroundJob({ ...completed, id: 'relay-1', kind: 'relay', result: { status: 'sent' } });

  const mine = await getNotificationSnapshot({ workspaceId: 'ws-a', userId: 'user-a' });
  assert.equal(mine.notifications.length, 1);
  const notice = mine.notifications[0];
  assert.equal(notice.appId, 'ocr');
  assert.equal(notice.workspaceId, 'ws-a');
  assert.equal(notice.userId, 'user-a');
  assert.equal(notice.jobId, 'job-ocr-1');
  assert.equal(notice.analysisId, 'ocr-finished');
  assert.equal(notice.outcome, 'success');
  assert.equal(notice.title, 'OCR finished');

  const otherWorkspace = await getNotificationSnapshot({ workspaceId: 'ws-b', userId: 'user-a' });
  assert.equal(otherWorkspace.notifications.length, 0);
  const otherUser = await getNotificationSnapshot({ workspaceId: 'ws-a', userId: 'user-b' });
  assert.equal(otherUser.notifications.length, 0);
  assert.equal(analysisUpdates.length, 0);
});

test('a failed OCR job notifies failure and stores the error on a stuck analysis', async () => {
  await notifyFinishedBackgroundJob({
    ...completed,
    id: 'job-ocr-failed',
    status: 'failed',
    result: null,
    error: 'Processing failed after repeated attempts. Retry from the source app.',
  });
  const mine = await getNotificationSnapshot({ workspaceId: 'ws-a', userId: 'user-a' });
  const failed = mine.notifications.find((notice) => notice.jobId === 'job-ocr-failed');
  assert.ok(failed);
  assert.equal(failed.outcome, 'failure');
  assert.equal(failed.title, 'OCR run failed');
  assert.equal(failed.analysisId, 'ocr-finished');
  assert.equal(failed.appId, 'ocr');
  const otherWorkspace = await getNotificationSnapshot({ workspaceId: 'ws-b', userId: 'user-a' });
  assert.equal(otherWorkspace.notifications.some((notice) => notice.jobId === 'job-ocr-failed'), false);
  assert.equal(analysisUpdates.length, 1);
  assert.equal(analysisUpdates[0].workspaceId, 'ws-a');
  assert.equal(analysisUpdates[0].userId, 'user-a');
  assert.equal(analysisUpdates[0].id, 'ocr-finished');
  assert.equal(analysisUpdates[0].patch.status, 'rows_only');
  assert.match(analysisUpdates[0].patch.error, /failed/i);
});

test('remount selects the finished analysis and does not resume a presented or foreign result', () => {
  assert.deepEqual(chooseFromJob({
    id: 'job-ocr-1', status: 'completed', analysisId: 'ocr-finished', presented: false,
  }), { action: 'show', analysisId: 'ocr-finished', jobId: 'job-ocr-1' });
  assert.deepEqual(chooseFromJob({
    id: 'job-ocr-1', status: 'running', analysisId: 'ocr-finished',
  }), { action: 'poll', jobId: 'job-ocr-1' });
  assert.deepEqual(chooseFromJob({
    id: 'job-ocr-1', status: 'completed', analysisId: 'ocr-finished', presented: true,
  }), { action: 'none' });
  const failure = chooseFromJob({
    id: 'job-ocr-failed', status: 'failed', analysisId: 'ocr-finished', error: 'The OCR run failed.',
  });
  assert.equal(failure.action, 'error');
  assert.equal(failure.analysisId, 'ocr-finished');
  assert.match(failure.message, /failed/i);
  assert.deepEqual(chooseOcrResume({
    launch: { analysisId: 'ocr-finished', jobId: 'job-ocr-1', outcome: 'success' },
    job: { id: 'newer', status: 'running', analysisId: 'ocr-other' },
  }), { action: 'show', analysisId: 'ocr-finished', jobId: 'job-ocr-1' });
  const openedFailure = chooseOcrResume({
    launch: { jobId: 'job-ocr-failed', analysisId: 'ocr-finished', outcome: 'failure' },
    job: { id: 'job-ocr-failed', status: 'failed', error: 'The OCR run failed.', analysisId: 'ocr-finished' },
  });
  assert.equal(openedFailure.action, 'error');
  assert.equal(openedFailure.analysisId, 'ocr-finished');
});
