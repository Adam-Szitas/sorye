import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flushPendingActions, registerPendingActionFlusher } from '../src/pending-actions';

test('flushPendingActions reports pending work and isolates a failed app flusher', async () => {
  const removeTasks = registerPendingActionFlusher('tasks', async () => 2);
  const removeNotes = registerPendingActionFlusher('notes', async () => { throw new Error('network'); });
  try {
    assert.deepEqual(await flushPendingActions(50), { remaining: 2, failedApps: 1 });
  } finally { removeTasks(); removeNotes(); }
});

test('flushPendingActions bounds an app that never settles', async () => {
  const remove = registerPendingActionFlusher('canvas', () => new Promise<number>(() => undefined));
  try {
    assert.deepEqual(await flushPendingActions(5), { remaining: 0, failedApps: 1 });
  } finally { remove(); }
});
