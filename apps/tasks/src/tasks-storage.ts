import {
  TASKS_LOCAL_STORAGE_KEY,
  createDefaultTasksBoard,
  type RodrigoAction,
  type RodrigoActionBatchResult,
  type TaskItem,
  type TasksBoard,
  type UserLoadPartition,
  type UserLoadWorkspace,
} from '@sorye/types';
import { hubApiPath } from './hub-origin';
import {
  enqueueTaskAction,
  classifyTaskActionOutcome,
  listTaskActions,
  removeTaskAction,
  updateTaskAction,
  type TaskQueueRow,
} from './tasks-action-queue';

export type { TasksBoard };
export interface TasksQueueState {
  pending: number;
  failed: number;
  conflicts: number;
  rejected: number;
}

export function createDefaultBoard(): TasksBoard { return createDefaultTasksBoard(); }

export function createTasksStorage() {
  let revision = 0;
  let activeScope: string | null = null;
  let lastLoad: UserLoadPartition<TaskItem> | null = null;
  let lastWorkspace: UserLoadWorkspace | null = null;
  let queue: Promise<void> = Promise.resolve();
  const conflictDraftKey = () => `sorye:tasks:conflict-draft:v1:${activeScope ?? 'unscoped'}`;

  class ApiError extends Error {
    constructor(readonly status: number, message: string) { super(message); }
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(hubApiPath(path), {
        credentials: 'include', ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      });
    } catch {
      throw new ApiError(0, 'Rodrigo could not be reached. Your task action remains safely queued in this browser.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = typeof data.error?.code === 'string' ? data.error.code : 'request_failed';
      throw new ApiError(response.status, code === 'rodrigo_unavailable' || response.status >= 500
        ? 'Rodrigo could not confirm this change. Your task action remains safely queued in this browser.'
        : `Task action failed (${code}).`);
    }
    return data as T;
  }

  async function readScope(): Promise<string> {
    const result = await request<{ queueScope: string; workspace: UserLoadWorkspace }>('/api/tasks/scope');
    if (!/^[a-f0-9]{64}$/.test(result.queueScope)) throw new Error('Hub returned an invalid task queue scope.');
    activeScope = result.queueScope;
    lastWorkspace = result.workspace;
    return activeScope;
  }

  async function rows(scope = activeScope): Promise<TaskQueueRow[]> {
    return scope ? listTaskActions(scope) : [];
  }

  async function queueState(): Promise<TasksQueueState> {
    const current = await rows();
    return {
      pending: current.filter((row) => row.status === 'pending').length,
      failed: current.filter((row) => row.status === 'failed').length,
      conflicts: current.filter((row) => row.status === 'conflict').length,
      rejected: current.filter((row) => row.status === 'rejected').length,
    };
  }

  function saveConflictDraft(board: TasksBoard) {
    try { localStorage.setItem(conflictDraftKey(), JSON.stringify({ savedAt: new Date().toISOString(), board })); }
    catch { /* The durable IndexedDB queue remains available if this convenience draft fails. */ }
  }

  async function flush(scope: string, actionIds?: ReadonlySet<string>): Promise<void> {
    const queued = await listTaskActions(scope);
    const candidates = queued.filter((row) => (row.status === 'pending' || row.status === 'failed') && (!actionIds || actionIds.has(row.action.actionId)));
    for (const row of candidates) {
      const retryRow: TaskQueueRow = { ...row, status: 'pending', attempts: row.attempts + 1, error: undefined };
      await updateTaskAction(scope, retryRow);
      let result: RodrigoActionBatchResult;
      try {
        result = await request<RodrigoActionBatchResult>('/api/backend/actions/batch', {
          method: 'POST', headers: { 'X-Sorye-Queue-Scope': scope }, body: JSON.stringify({ actions: [retryRow.action] }),
        });
      } catch (error) {
        await updateTaskAction(scope, { ...retryRow, status: 'failed', error: error instanceof Error ? error.message : 'Unknown network failure' });
        continue;
      }
      const outcome = result.results.find((item) => item.actionId === retryRow.action.actionId);
      if (!outcome) {
        await updateTaskAction(scope, { ...retryRow, status: 'failed', error: 'Rodrigo returned no result for this task action.' });
        continue;
      }
      const disposition = classifyTaskActionOutcome(outcome);
      if (disposition === 'acknowledged') {
        revision = Math.max(revision, outcome.revision ?? revision);
        await removeTaskAction(scope, retryRow.action.actionId);
      } else if (disposition === 'conflict') {
        const error = outcome.error?.message ?? 'The task board changed in another session. Reload and reconcile your queued board.';
        await updateTaskAction(scope, { ...retryRow, status: 'conflict', error });
        if (retryRow.action.payload && typeof retryRow.action.payload === 'object') saveConflictDraft(retryRow.action.payload as unknown as TasksBoard);
      } else {
        await updateTaskAction(scope, { ...retryRow, status: disposition, error: outcome.error?.message ?? outcome.error?.code ?? 'Rodrigo rejected this action.' });
      }
    }
  }

  async function readBoard(): Promise<{ board: TasksBoard; revision: number }> {
    const result = await request<{ board: TasksBoard; revision: number; load?: UserLoadPartition<TaskItem>; workspace?: UserLoadWorkspace }>('/api/tasks');
    revision = result.revision;
    lastLoad = result.load ?? null;
    lastWorkspace = result.workspace ?? lastWorkspace;
    return { board: result.board, revision };
  }

  async function loadBoard(): Promise<TasksBoard> {
    const scope = await readScope();
    let current: { board: TasksBoard; revision: number } | null = null;
    try { current = await readBoard(); }
    catch (readError) {
      await flush(scope);
      try { current = await readBoard(); }
      catch {
        const pending = await listTaskActions(scope);
        const latest = pending.at(-1);
        if (latest && latest.action.resourceType === 'taskBoard' && latest.action.payload && typeof latest.action.payload === 'object') {
          lastLoad = null;
          current = { board: latest.action.payload as unknown as TasksBoard, revision };
        } else {
          throw readError;
        }
      }
    }

    const before = await listTaskActions(scope);
    if (before.some((row) => row.status === 'pending' || row.status === 'failed')) {
      await flush(scope);
      const after = await listTaskActions(scope);
      const committedSome = before.some((row) => !after.some((remaining) => remaining.action.actionId === row.action.actionId));
      if (committedSome) current = await readBoard();
    }
    try { localStorage.removeItem(TASKS_LOCAL_STORAGE_KEY); } catch { /* Old device copies are never imported. */ }
    return current.board;
  }

  async function saveBoard(board: TasksBoard): Promise<TasksBoard> {
    const scope = activeScope ?? await readScope();
    const action: RodrigoAction = {
      actionId: crypto.randomUUID(), appId: 'tasks', resourceType: 'taskBoard',
      operation: revision === 0 ? 'create' : 'update', resourceId: 'main',
      ...(revision === 0 ? {} : { expectedRevision: revision }),
      payloadVersion: 1, payload: board as unknown as Record<string, unknown>, occurredAt: new Date().toISOString(),
    };
    await enqueueTaskAction(scope, action);
    const run = queue.then(() => flush(scope, new Set([action.actionId])));
    queue = run.then(() => undefined, () => undefined);
    await run;
    const remaining = await listTaskActions(scope);
    const row = remaining.find((item) => item.action.actionId === action.actionId);
    if (row?.status === 'conflict') throw new ApiError(409, row.error ?? 'The task board changed in another session. Reload and reconcile.');
    if (row) throw new ApiError(503, row.error ?? 'Rodrigo has not confirmed this task change.');
    clearConflictDraft();
    return board;
  }

  async function resendPending(): Promise<void> {
    const scope = activeScope ?? await readScope();
    const available = await listTaskActions(scope);
    await flush(scope, new Set(available.filter((row) => row.status === 'pending' || row.status === 'failed').map((row) => row.action.actionId)));
  }

  async function discardConflictsAndRejected(): Promise<void> {
    const scope = activeScope;
    if (!scope) return;
    const rows = await listTaskActions(scope);
    for (const row of rows) if (row.status === 'conflict' || row.status === 'rejected') await removeTaskAction(scope, row.action.actionId);
  }

  function readConflictDraft(): TasksBoard | null {
    try {
      const parsed = JSON.parse(localStorage.getItem(conflictDraftKey()) ?? 'null') as { board?: unknown } | null;
      return parsed?.board && typeof parsed.board === 'object' ? parsed.board as TasksBoard : null;
    } catch { return null; }
  }
  function clearConflictDraft() { try { localStorage.removeItem(conflictDraftKey()); } catch { /* optional draft */ } }
  function isConflict(error: unknown) { return error instanceof ApiError && error.status === 409; }
  function readTaskLoad() { return { load: lastLoad, workspace: lastWorkspace }; }

  return { loadBoard, saveBoard, readConflictDraft, clearConflictDraft, isConflict, readTaskLoad, queueState, resendPending, discardConflictsAndRejected };
}
