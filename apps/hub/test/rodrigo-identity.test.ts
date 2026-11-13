import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { docker, harnessConfigured, startRodrigo, type Harness } from './helpers/rodrigo-harness';

process.env.AUTH_SECRET ??= 'test-only-auth-secret-0123456789';

/**
 * Alignment slice 1: identity owned by Rodrigo, resolved by Hub through the signed
 * rodrigo-identity grant, cached with change-stream invalidation, and re-verified by
 * Rodrigo on every workspace-scoped request (enforce_membership).
 */
const login = (suffix = randomUUID().slice(0, 8)) => ({
  id: `idt-${suffix}`, email: `idt-${suffix}@example.test`, displayName: `User ${suffix}`, isAdmin: false,
});
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
async function waitFor(check: () => Promise<boolean> | boolean, ms = 3000) {
  for (const started = Date.now(); Date.now() - started < ms;) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe('identity owned by Rodrigo', { skip: !harnessConfigured, concurrency: false }, () => {
  let rodrigo: Harness;
  before(async () => {
    rodrigo = await startRodrigo({ extraProviders: { enforce_membership: true } });
    const { ensureRodrigoChangeStream, rodrigoChangesHealthy } = await import('../lib/rodrigo/changes');
    ensureRodrigoChangeStream();
    await waitFor(() => rodrigoChangesHealthy(), 5000);
  });
  after(async () => {
    (await import('../lib/rodrigo/changes')).stopRodrigoChangeStream();
    await rodrigo?.stop();
  });

  test('first sign-in creates the user and a free Personal workspace; repeat reads are cached', async () => {
    const store = await import('../lib/store');
    const user = login();
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => { if (String(url).includes('/v2/identity/')) calls += 1; return realFetch(url, init); }) as typeof fetch;
    try {
      const first = await store.resolveLoginSession(user);
      assert.equal(first.user.email, user.email);
      assert.equal(first.workspace.kind, 'personal');
      assert.equal(first.workspace.subscriptionId, 'free');
      assert.deepEqual(first.workspace.selectedAppIds, ['dashboard']);
      assert.deepEqual(first.workspaces.map((w) => w.kind), ['personal']);
      assert.ok('storage' in first.workspace, 'Hub decorates the storage summary');
      const before = calls;
      await store.resolveLoginSession(user);
      assert.equal(calls, before, 'second resolution served from cache');
      const renamed = await store.resolveLoginSession({ ...user, displayName: 'Renamed' });
      assert.equal(renamed.user.displayName, 'Renamed');
    } finally { globalThis.fetch = realFetch; }
  });

  test('concurrent first sign-ins converge on one user and one workspace', async () => {
    const store = await import('../lib/store');
    const user = login();
    const sessions = await Promise.all(Array.from({ length: 12 }, () => store.resolveLoginSession(user)));
    assert.equal(new Set(sessions.map((s) => s.workspace.id)).size, 1);
    assert.equal(new Set(sessions.map((s) => s.user.personalWorkspaceId)).size, 1);
  });

  test('an email already used by another login is refused', async () => {
    const store = await import('../lib/store');
    const { RodrigoResponseError } = await import('../lib/rodrigo/service-client');
    const user = login();
    await store.resolveLoginSession(user);
    await assert.rejects(store.resolveLoginSession({ ...user, id: `${user.id}-other` }),
      (error: unknown) => error instanceof RodrigoResponseError && error.code === 'email_in_use');
  });

  test('plan rules: teams, app limits, tier change keeps apps, assignment trims', async () => {
    const store = await import('../lib/store');
    const user = login();
    const personal = await store.resolveLoginSession(user);
    assert.equal(await store.createTeamWorkspace(user.id, 'Team A'), null, 'free plan cannot create teams');
    assert.equal(await store.updateWorkspace(user.id, personal.workspace.id, { selectedAppIds: ['tasks', 'notes', 'mail'] }), null, 'free allows 2 apps');
    const ok = await store.updateWorkspace(user.id, personal.workspace.id, { selectedAppIds: ['tasks', 'notes', 'catalog'] });
    assert.deepEqual(ok?.workspace.selectedAppIds, ['tasks', 'notes', 'catalog']);
    await store.setWorkspaceTier(personal.workspace.id, 'pro');
    const team = await store.createTeamWorkspace(user.id, 'Team A');
    assert.ok(team, 'pro can create one team');
    assert.equal(team!.workspace.kind, 'team');
    assert.equal(team!.user.activeWorkspaceId, team!.workspace.id);
    assert.deepEqual(team!.workspaces.map((w) => w.kind), ['personal', 'team']);
    assert.equal(await store.createTeamWorkspace(user.id, 'Team B'), null, 'pro allows one team');
    await store.updateWorkspace(user.id, team!.workspace.id, { selectedAppIds: ['tasks', 'notes', 'mail', 'ocr'] });
    const tier = await store.setWorkspaceTier(team!.workspace.id, 'free');
    assert.equal(tier?.selectedAppIds.length, 4, 'tier change keeps locked apps');
    const assigned = await store.assignWorkspacePlan(team!.workspace.id, 'free');
    assert.deepEqual(assigned?.selectedAppIds, ['tasks', 'notes'], 'assignment trims');
    const members = await store.getWorkspaceMembers(team!.workspace.id);
    assert.deepEqual(members.map((m) => m.id), [user.id]);
    assert.ok(await store.operatorWorkspaceExists(team!.workspace.id));
    assert.ok(!(await store.operatorWorkspaceExists('ws-team-nothere')));
    assert.ok((await store.listOperatorWorkspaces()).some((w) => w.id === team!.workspace.id));
    assert.ok((await store.listUsers()).some((u) => u.email === user.email));
    assert.equal((await store.getUserByEmail(user.email.toUpperCase()))?.id, user.id);
    const back = await store.switchActiveWorkspace(user.id, personal.workspace.id);
    assert.equal(back?.workspace.id, personal.workspace.id);
  });

  test('non-members cannot switch to, read or act in a workspace', async () => {
    const store = await import('../lib/store');
    const { getRodrigoResource, RodrigoResponseError } = await import('../lib/rodrigo/service-client');
    const owner = login();
    const stranger = login();
    const ownerSession = await store.resolveLoginSession(owner);
    await store.resolveLoginSession(stranger);
    assert.equal(await store.switchActiveWorkspace(stranger.id, ownerSession.workspace.id), null);
    assert.equal(await store.getHubSessionForWorkspace(stranger.id, ownerSession.workspace.id), null);
    // Rodrigo re-verifies membership on workspace-scoped routes, whatever Hub signs.
    await assert.rejects(getRodrigoResource({ userId: stranger.id, workspaceId: ownerSession.workspace.id }, 'workspace', 'settings', 'main'),
      (error: unknown) => error instanceof RodrigoResponseError && error.code === 'not_member');
    const own = await getRodrigoResource({ userId: owner.id, workspaceId: ownerSession.workspace.id }, 'workspace', 'settings', 'main');
    assert.equal(own.resource, null);
  });

  test('a plan change elsewhere reaches cached sessions through the change stream', async () => {
    const store = await import('../lib/store');
    const user = login();
    const session = await store.resolveLoginSession(user);
    await store.resolveLoginSession(user); // cached
    const started = performance.now();
    await store.setWorkspaceTier(session.workspace.id, 'starter');
    assert.ok(await waitFor(async () => (await store.resolveLoginSession(user)).workspace.subscriptionId === 'starter'), 'cache invalidated');
    console.log(`[measure] identity change visible to Hub sessions after ${(performance.now() - started).toFixed(0)} ms`);
  });

  test('session resolution latency, cached and uncached', async () => {
    const store = await import('../lib/store');
    const { identityCacheSize } = await import('../lib/rodrigo/identity-client');
    const users = Array.from({ length: 40 }, () => login());
    for (const user of users) await store.resolveLoginSession(user);
    const uncached: number[] = [];
    for (const user of users) {
      const t = performance.now();
      await store.getHubSessionForWorkspace(user.id, (await store.resolveLoginSession(user)).user.personalWorkspaceId);
      uncached.push(performance.now() - t);
    }
    const cachedTimes: number[] = [];
    for (const user of users) { const t = performance.now(); await store.resolveLoginSession(user); cachedTimes.push(performance.now() - t); }
    console.log(`[measure] session read uncached p50 ${percentile(uncached, 50).toFixed(1)} ms p95 ${percentile(uncached, 95).toFixed(1)} ms; cached p50 ${percentile(cachedTimes, 50).toFixed(2)} ms p95 ${percentile(cachedTimes, 95).toFixed(2)} ms; cache entries ${identityCacheSize()}`);
  });

  test('database down: sign-in fails closed and recovers', { skip: !process.env.RODRIGO_TEST_POSTGRES_CONTAINER }, async () => {
    const store = await import('../lib/store');
    await docker('stop', process.env.RODRIGO_TEST_POSTGRES_CONTAINER!);
    try {
      await assert.rejects(store.resolveLoginSession(login()));
    } finally {
      await docker('start', process.env.RODRIGO_TEST_POSTGRES_CONTAINER!);
    }
    assert.ok(await waitFor(async () => store.resolveLoginSession(login()).then(() => true, () => false), 20000), 'recovers');
  });
});
