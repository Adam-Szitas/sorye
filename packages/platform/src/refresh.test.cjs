// node --test packages/platform/src/refresh.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function browser() {
  let now = 0, nextId = 0;
  const timers = new Map();
  const window = new EventTarget();
  window.setTimeout = (fn, ms) => { const id = ++nextId; timers.set(id, { at: now + ms, fn }); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  const document = new EventTarget();
  document.visibilityState = 'visible';
  const navigator = { onLine: true };
  const channels = new Set();
  class BroadcastChannel {
    constructor(name) { this.name = name; channels.add(this); }
    postMessage() { for (const other of channels) if (other !== this && other.name === this.name) other.onmessage?.(); }
    close() { channels.delete(this); }
  }
  const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
  const advance = async (ms) => {
    const end = now + ms;
    for (let n = 0; n < 1000; n++) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { now = end; await flush(); return; }
      now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    }
    throw new Error('Timer loop did not settle');
  };
  const broadcast = (name) => { const sender = new BroadcastChannel(name); sender.postMessage(); sender.close(); };
  const load = (file, mocks = {}) => {
    const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    const requireMock = (name) => {
      if (name in mocks) return mocks[name];
      if (name === './refresh') return load('refresh.ts', mocks);
      throw new Error(`Unmocked import: ${name}`);
    };
    new Function('module', 'exports', 'require', 'window', 'document', 'navigator', 'BroadcastChannel', 'Date', 'fetch', source)(
      module, module.exports, requireMock, window, document, navigator, BroadcastChannel, { now: () => now }, mocks.fetch,
    );
    return module.exports;
  };
  return { window, document, navigator, timers, channels, flush, advance, broadcast, load };
}

test('kernel uses separate safety intervals and coalesces three notification channels without refetching workspace', async () => {
  const b = browser();
  const calls = [];
  const { startKernelSync } = b.load('sync.ts', {
    '@sorye/types': { HUB_NOTIFY_EVENT: 'notify', NOTIFICATION_BROADCAST_CHANNEL: 'notifications', RELAY_BROADCAST_CHANNEL: 'relay' },
    './transport': { hubUrl: (url) => url },
    fetch: async (url) => { calls.push(url); return { ok: true, json: async () => ({ unreadTotal: 2 }) }; },
  });
  const stop = startKernelSync({ setSession() {}, setNotificationUnread() {} });
  await b.flush();
  assert.deepEqual(calls, ['/api/workspace', '/api/notifications']);
  await b.advance(2000);
  b.window.dispatchEvent(new Event('notify'));
  b.broadcast('notifications'); b.broadcast('relay');
  await b.advance(100);
  assert.deepEqual(calls, ['/api/workspace', '/api/notifications', '/api/notifications']);
  await b.advance(60_000);
  assert.equal(calls.filter((url) => url === '/api/notifications').length, 3);
  assert.equal(calls.filter((url) => url === '/api/workspace').length, 1);
  await b.advance(240_000);
  assert.equal(calls.filter((url) => url === '/api/workspace').length, 2);
  stop(); await b.flush();
  assert.equal(b.timers.size, 0);
  assert.equal(b.channels.size, 0);
});

test('hidden/offline tabs send no requests, then refresh when visible/online', async () => {
  const b = browser();
  b.document.visibilityState = 'hidden';
  let calls = 0;
  const { startVisibleRefresh } = b.load('refresh.ts');
  const loop = startVisibleRefresh(async () => { calls++; }, { intervalMs: 60_000 });
  await b.advance(600_000);
  assert.equal(calls, 0);
  b.document.visibilityState = 'visible'; b.document.dispatchEvent(new Event('visibilitychange'));
  await b.advance(100);
  assert.equal(calls, 1);
  b.navigator.onLine = false; b.window.dispatchEvent(new Event('offline'));
  await b.advance(600_000);
  assert.equal(calls, 1);
  b.navigator.onLine = true; b.window.dispatchEvent(new Event('online'));
  await b.advance(100);
  assert.equal(calls, 2);
  loop.dispose();
});

test('a burst during a slow request produces one trailing refresh and never overlaps', async () => {
  const b = browser();
  let calls = 0, finish;
  const { startVisibleRefresh } = b.load('refresh.ts');
  const loop = startVisibleRefresh(async () => {
    calls++;
    if (calls === 1) await new Promise((resolve) => { finish = resolve; });
  }, { intervalMs: 60_000, events: ['notify'] });
  await b.flush();
  for (let n = 0; n < 100; n++) b.window.dispatchEvent(new Event('notify'));
  await b.advance(5000);
  assert.equal(calls, 1);
  finish(); await b.flush(); await b.advance(100);
  assert.equal(calls, 2);
  loop.dispose(); await b.advance(600_000);
  assert.equal(calls, 2);
});

test('request timeout aborts the fetch and retries only at the safety interval', async () => {
  const b = browser();
  let calls = 0, aborted = false;
  const { startVisibleRefresh } = b.load('refresh.ts');
  const loop = startVisibleRefresh(async (signal) => {
    calls++;
    await new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }));
  }, { intervalMs: 60_000 });
  await b.flush(); await b.advance(15_000);
  assert.equal(aborted, true);
  await b.advance(59_999); assert.equal(calls, 1);
  await b.advance(1); assert.equal(calls, 2);
  loop.dispose(); await b.flush();
  assert.equal(b.timers.size, 0);
});

test('unmount aborts active requests and removes all timers and notification subscriptions', async () => {
  const b = browser();
  let signal;
  const { startVisibleRefresh } = b.load('refresh.ts');
  const loop = startVisibleRefresh(async (current) => {
    signal = current;
    await new Promise((resolve) => current.addEventListener('abort', resolve));
  }, { intervalMs: 60_000, events: ['notify'], channels: ['notifications'] });
  await b.flush(); loop.dispose(); await b.flush();
  assert.equal(signal.aborted, true);
  assert.equal(b.timers.size, 0);
  assert.equal(b.channels.size, 0);
  b.window.dispatchEvent(new Event('notify')); await b.advance(100_000);
  assert.equal(b.timers.size, 0);
});

test('disposal before the first microtask prevents the initial network request', async () => {
  const b = browser(); let calls = 0;
  const { startVisibleRefresh } = b.load('refresh.ts');
  const loop = startVisibleRefresh(async () => { calls++; }, { intervalMs: 60_000 });
  loop.dispose(); await b.flush();
  assert.equal(calls, 0);
  assert.equal(b.timers.size, 0);
});
