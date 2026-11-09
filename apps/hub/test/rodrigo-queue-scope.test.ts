import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionQueueScopeMatches, deriveActionQueueScope } from '../lib/rodrigo/queue-scope';

test('action queue scope binds app, authenticated user, and workspace', () => {
  const scope = deriveActionQueueScope('notes', 'user-a', 'workspace-a');
  assert.match(scope, /^[a-f0-9]{64}$/);
  assert.equal(actionQueueScopeMatches(scope, 'notes', 'user-a', 'workspace-a'), true);
  assert.equal(actionQueueScopeMatches(scope, 'calendar', 'user-a', 'workspace-a'), false);
  assert.equal(actionQueueScopeMatches(scope, 'notes', 'user-b', 'workspace-a'), false);
  assert.equal(actionQueueScopeMatches(scope, 'notes', 'user-a', 'workspace-b'), false);
  assert.equal(actionQueueScopeMatches(null, 'notes', 'user-a', 'workspace-a'), false);
  assert.equal(actionQueueScopeMatches('not-a-hash', 'notes', 'user-a', 'workspace-a'), false);
});
