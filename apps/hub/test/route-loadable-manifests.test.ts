import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ROUTE_LOADABLE_MANIFEST,
  reconcileRouteManifests,
  routeDirsFromSource,
  seedRouteManifests,
  startRouteManifestShim,
} from '../scripts/route-loadable-manifests';

function scratch(): string {
  return mkdtempSync(path.join(tmpdir(), 'sorye-route-manifests-'));
}

function touch(file: string, content = ''): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test('finds route handlers, including dynamic segments, and ignores pages and private folders', () => {
  const root = scratch();
  try {
    const app = path.join(root, 'app');
    touch(path.join(app, 'api', 'notifications', 'route.ts'));
    touch(path.join(app, 'api', 'files', '[id]', 'route.ts'));
    touch(path.join(app, 'api', 'auth', '[...nextauth]', 'route.ts'));
    touch(path.join(app, 'architecture', 'page.tsx'));
    touch(path.join(app, '_private', 'route.ts'));
    assert.deepEqual(routeDirsFromSource(app).sort(), [
      path.join('api', 'auth', '[...nextauth]', 'route'),
      path.join('api', 'files', '[id]', 'route'),
      path.join('api', 'notifications', 'route'),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seeds an empty manifest once and never replaces an existing one', () => {
  const root = scratch();
  try {
    const app = path.join(root, 'app');
    const output = path.join(root, '.next', 'server', 'app');
    touch(path.join(app, 'api', 'workspace', 'route.ts'));
    touch(path.join(app, 'api', 'tasks', 'route.ts'));
    const existing = path.join(output, 'api', 'tasks', 'route', ROUTE_LOADABLE_MANIFEST);
    touch(existing, '{"emitted":"by-turbopack"}');

    assert.equal(seedRouteManifests(app, output), 1);
    assert.equal(readFileSync(path.join(output, 'api', 'workspace', 'route', ROUTE_LOADABLE_MANIFEST), 'utf8'), '{}');
    assert.equal(readFileSync(existing, 'utf8'), '{"emitted":"by-turbopack"}');
    assert.equal(seedRouteManifests(app, output), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reconcile covers compiled routes that have no source route file and leaves pages alone', () => {
  const root = scratch();
  try {
    const output = path.join(root, '.next', 'server', 'app');
    touch(path.join(output, 'sitemap.xml', 'route', 'app-paths-manifest.json'), '{}');
    touch(path.join(output, 'architecture', 'page', 'app-paths-manifest.json'), '{}');
    // A directory that only looks like a route output is not touched.
    mkdirSync(path.join(output, 'stale', 'route'), { recursive: true });

    assert.equal(reconcileRouteManifests(output), 1);
    assert.ok(existsSync(path.join(output, 'sitemap.xml', 'route', ROUTE_LOADABLE_MANIFEST)));
    assert.ok(!existsSync(path.join(output, 'architecture', 'page', ROUTE_LOADABLE_MANIFEST)));
    assert.ok(!existsSync(path.join(output, 'stale', 'route', ROUTE_LOADABLE_MANIFEST)));
    assert.equal(reconcileRouteManifests(output), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the running shim restores manifests after the output directory is removed', async () => {
  const root = scratch();
  const app = path.join(root, 'app');
  const manifest = path.join(root, '.next', 'server', 'app', 'api', 'events', 'route', ROUTE_LOADABLE_MANIFEST);
  touch(path.join(app, 'api', 'events', 'route.ts'));
  const stop = startRouteManifestShim(root, { intervalMs: 20 });
  try {
    assert.ok(existsSync(manifest));
    rmSync(path.join(root, '.next'), { recursive: true, force: true });
    const deadline = Date.now() + 2_000;
    while (!existsSync(manifest) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(existsSync(manifest));
  } finally {
    stop();
    rmSync(root, { recursive: true, force: true });
  }
});
