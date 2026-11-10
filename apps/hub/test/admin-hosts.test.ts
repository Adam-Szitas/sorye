import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adminOrigin,
  classifyHost,
  effectiveHost,
  hostConfig,
  isAdminOnlyApi,
  isAdminSurfacePath,
  mutationOriginDenied,
} from '../lib/admin/hosts';

const prod = hostConfig({ NODE_ENV: 'production' });
const dev = hostConfig({ NODE_ENV: 'development' });

test('production classifies exact hosts only', () => {
  const direct = { forwarded: false };
  const proxied = { forwarded: true };
  assert.equal(classifyHost('sorye.app', proxied, prod), 'customer');
  assert.equal(classifyHost('admin.sorye.app', proxied, prod), 'admin');
  assert.equal(classifyHost('ADMIN.SORYE.APP:443', proxied, prod), 'admin');
  assert.equal(classifyHost('tasks.sorye.app', proxied, prod), 'app');
  assert.equal(classifyHost('evil.example', proxied, prod), 'unknown');
  assert.equal(classifyHost('admin.sorye.app.evil.example', proxied, prod), 'unknown');
  assert.equal(classifyHost('xadmin.sorye.app', proxied, prod), 'unknown');
  assert.equal(classifyHost('nope.sorye.app', proxied, prod), 'unknown');
  assert.equal(classifyHost('', proxied, prod), 'unknown');
  assert.equal(classifyHost('127.0.0.1:3000', direct, prod), 'customer');
  assert.equal(classifyHost('127.0.0.1:3000', proxied, prod), 'unknown');
  assert.equal(classifyHost('admin.localhost:3000', proxied, prod), 'unknown');
});

test('configured hosts and extra customer aliases', () => {
  const custom = hostConfig({
    NODE_ENV: 'production',
    SORYE_PUBLIC_HOST: 'example.test',
    SORYE_ADMIN_HOST: 'ops.example.test',
    SORYE_EXTRA_HOSTS: 'www.example.test, bad host',
  });
  assert.equal(classifyHost('ops.example.test', { forwarded: true }, custom), 'admin');
  assert.equal(classifyHost('admin.example.test', { forwarded: true }, custom), 'unknown');
  assert.equal(classifyHost('www.example.test', { forwarded: true }, custom), 'customer');
  assert.equal(classifyHost('notes.example.test', { forwarded: true }, custom), 'app');
});

test('development admin host is admin.localhost; others are customer', () => {
  assert.equal(classifyHost('admin.localhost:23000', { forwarded: false }, dev), 'admin');
  assert.equal(classifyHost('127.0.0.1:23000', { forwarded: false }, dev), 'customer');
  assert.equal(classifyHost('evil.example', { forwarded: false }, dev), 'customer');
  assert.equal(adminOrigin('127.0.0.1:23000', 'http:', dev), 'http://admin.localhost:23000');
  assert.equal(adminOrigin('evil.example:1', 'http:', prod), 'https://admin.sorye.app');
});

test('forwarded host wins, first value only', () => {
  const headers = new Headers({ host: 'hub:3000', 'x-forwarded-host': 'admin.sorye.app, evil.example' });
  assert.deepEqual(effectiveHost(headers), { host: 'admin.sorye.app', forwarded: true });
  assert.deepEqual(effectiveHost(new Headers({ host: 'sorye.app' })), { host: 'sorye.app', forwarded: false });
});

test('admin surface is an allowlist', () => {
  for (const path of ['/admin', '/admin/ai', '/api/admin/console/overview', '/api/operator/plan', '/api/auth/session', '/login', '/_next/static/x.js', '/api/backend/topology']) {
    assert.equal(isAdminSurfacePath(path, true), true, path);
  }
  for (const path of ['/', '/apps/tasks', '/api/tasks', '/administrator', '/api/adminx', '/learn/tasks/en', '/__nextjs_original-stack-frame', '/embed/tasks']) {
    assert.equal(isAdminSurfacePath(path, true), false, path);
  }
  assert.equal(isAdminSurfacePath('/__nextjs_original-stack-frame', false), true);
  assert.equal(isAdminOnlyApi('/api/admin/llm'), true);
  assert.equal(isAdminOnlyApi('/api/operator'), true);
  assert.equal(isAdminOnlyApi('/api/admin/subscription'), false);
  assert.equal(isAdminOnlyApi('/api/notices'), false);
});

test('mutations require a matching origin', () => {
  const base = { method: 'POST', pathname: '/api/admin/console/config/shared-ai', origin: null, secFetchSite: null, requestHost: 'admin.sorye.app', devAllowedOrigin: false };
  assert.equal(mutationOriginDenied(base), null);
  assert.equal(mutationOriginDenied({ ...base, origin: 'https://admin.sorye.app', secFetchSite: 'same-origin' }), null);
  assert.equal(mutationOriginDenied({ ...base, origin: 'https://tasks.sorye.app', secFetchSite: 'same-site' }), 'cross_site_request');
  assert.equal(mutationOriginDenied({ ...base, origin: 'https://tasks.sorye.app' }), 'origin_mismatch');
  assert.equal(mutationOriginDenied({ ...base, origin: 'null' }), 'invalid_origin');
  assert.equal(mutationOriginDenied({ ...base, secFetchSite: 'cross-site' }), 'cross_site_request');
  assert.equal(mutationOriginDenied({ ...base, method: 'GET', secFetchSite: 'cross-site' }), null);
  assert.equal(mutationOriginDenied({ ...base, pathname: '/api/auth/signin/google', secFetchSite: 'cross-site' }), null);
  assert.equal(mutationOriginDenied({ ...base, pathname: '/api/embed/bootstrap', secFetchSite: 'cross-site' }), null);
  assert.equal(mutationOriginDenied({ ...base, pathname: '/admin', secFetchSite: 'cross-site' }), null);
});
