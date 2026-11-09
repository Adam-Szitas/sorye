import { createDurableActionQueue, type DurableActionQueue } from '@sorye/platform';
import type { CanvasBoard, CanvasBoardSummary, CanvasDocument, CanvasPresenceUser, RodrigoAction, RodrigoActionResult, UserLoadPartition } from '@sorye/types';

export interface CanvasBootstrap {
  workspace: { id: string; kind: 'personal' | 'team'; name: string };
  user: { id: string; displayName: string; image?: string };
  boards: CanvasBoardSummary[];
  load?: UserLoadPartition<CanvasBoardSummary>;
  queue: { pending: number; failed: number; conflicts: number; rejected: number };
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch { throw new ApiError(0, 'Hub or Rodrigo is unreachable. The Canvas action remains queued on this device.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? `Request failed (${response.status})`);
  return data as T;
}

type ScopeInfo = { queueScope: string };
let cachedScope: string | undefined;
let cachedQueue: DurableActionQueue<RodrigoAction> | undefined;

async function scopeInfo(): Promise<ScopeInfo> {
  const info = await api<ScopeInfo>('/api/canvas/scope');
  if (!/^[a-f0-9]{64}$/.test(info.queueScope)) throw new ApiError(502, 'Hub returned an invalid Canvas queue scope.');
  if (cachedScope !== info.queueScope) {
    cachedQueue?.close();
    cachedScope = info.queueScope;
    cachedQueue = createDurableActionQueue<RodrigoAction>({ appId: 'canvas', scope: cachedScope, maxRows: 200 });
  }
  return info;
}

async function actionQueue() {
  try {
    const scope = await scopeInfo();
    return { scope, queue: cachedQueue! };
  } catch (error) {
    // Once an authorized scope has been established, an offline edit can still
    // be persisted in that partition. Hub verifies the scope header at send time.
    if (cachedScope && cachedQueue) return { scope: { queueScope: cachedScope }, queue: cachedQueue };
    throw error;
  }
}

async function settleAction(scope: string, q: DurableActionQueue<RodrigoAction>, action: RodrigoAction): Promise<RodrigoActionResult> {
  await q.markAttempt(action.actionId);
  let result: { results: RodrigoActionResult[] };
  try {
    result = await api('/api/backend/actions/batch', { method: 'POST', headers: { 'X-Sorye-Queue-Scope': scope }, body: JSON.stringify({ actions: [action] }) });
  } catch (error) {
    await q.markTransportFailure(action.actionId, { code: 'transport_failure', message: error instanceof Error ? error.message : 'Network failure' });
    throw error;
  }
  const outcome = result.results?.find((item) => item.actionId === action.actionId);
  if (!outcome) {
    await q.markTransportFailure(action.actionId, { code: 'missing_action_result', message: 'Rodrigo returned no result for this Canvas action.' });
    throw new ApiError(502, 'Rodrigo returned no result for this Canvas action. It remains queued.');
  }
  await q.settle(outcome);
  if (outcome.status === 'conflict') throw new ApiError(409, outcome.error?.message ?? 'This Canvas board changed elsewhere. Reload and reconcile before retrying.');
  if (outcome.status === 'rejected') throw new ApiError(422, outcome.error?.message ?? outcome.error?.code ?? 'Rodrigo rejected this Canvas action.');
  return outcome;
}

async function enqueueAndCommit(action: RodrigoAction) {
  const { scope, queue } = await actionQueue();
  await queue.enqueue(action);
  const outcome = await settleAction(scope.queueScope, queue, action);
  return outcome;
}

export async function loadBootstrap(): Promise<CanvasBootstrap> {
  await scopeInfo();
  const snapshot = await api<Omit<CanvasBootstrap, 'queue'>>('/api/canvas/boards');
  const rows = await cachedQueue!.list();
  return { ...snapshot, queue: queueCounts(rows) };
}

function queueCounts(rows: Array<{ status: string }>) {
  return {
    pending: rows.filter((row) => row.status === 'pending').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    conflicts: rows.filter((row) => row.status === 'conflict').length,
    rejected: rows.filter((row) => row.status === 'rejected').length,
  };
}

export async function readCanvasQueue() {
  const { queue } = await actionQueue();
  return queueCounts(await queue.list());
}

export async function readCanvasConflicts() {
  const { queue } = await actionQueue();
  return (await queue.list()).filter((row) => row.status === 'conflict' || row.status === 'rejected')
    .map((row) => ({ actionId: row.action.actionId, resourceId: row.action.resourceId, status: row.status, error: row.lastError, payload: row.action.payload }));
}

export async function discardCanvasConflict(actionId: string) {
  const { queue } = await actionQueue();
  return queue.discard(actionId);
}

export async function resendPendingCanvasActions() {
  const { scope, queue } = await actionQueue();
  const pending = await queue.list();
  for (const row of pending) {
    if (row.status === 'pending' || row.status === 'failed') {
      try { await settleAction(scope.queueScope, queue, row.action); } catch { /* row remains visible for retry/reconciliation */ }
    }
  }
  return queueCounts(await queue.list());
}

export async function loadBoard(boardId: string) {
  await scopeInfo();
  return api<CanvasBoard>(`/api/canvas/boards/${encodeURIComponent(boardId)}`);
}

export async function createBoard(title: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const payload = { id, title, document: { items: [], viewport: { x: 0, y: 0, zoom: 1 } }, updatedAt: now };
  const action: RodrigoAction = { actionId: crypto.randomUUID(), appId: 'canvas', resourceType: 'board', operation: 'create', resourceId: id, payloadVersion: 1, payload, occurredAt: now };
  await enqueueAndCommit(action);
  return loadBoard(id);
}

export async function saveBoard(boardId: string, patch: { title?: string; document?: CanvasDocument; expectedRevision?: number }) {
  if (!Number.isInteger(patch.expectedRevision) || !patch.expectedRevision) throw new ApiError(409, 'Canvas board revision is missing. Reload before saving.');
  if (!patch.title || !patch.document) throw new ApiError(400, 'Canvas save requires the complete board snapshot.');
  const now = new Date().toISOString();
  const action: RodrigoAction = { actionId: crypto.randomUUID(), appId: 'canvas', resourceType: 'board', operation: 'update', resourceId: boardId, expectedRevision: patch.expectedRevision,
    payloadVersion: 1, payload: { id: boardId, title: patch.title, document: patch.document, updatedAt: now }, occurredAt: now };
  await enqueueAndCommit(action);
  return loadBoard(boardId);
}

export async function deleteBoard(boardId: string, expectedRevision: number): Promise<{ ok: true }> {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new ApiError(409, 'Canvas board revision is missing. Reload before deleting.');
  const now = new Date().toISOString();
  const action: RodrigoAction = { actionId: crypto.randomUUID(), appId: 'canvas', resourceType: 'board', operation: 'delete', resourceId: boardId,
    expectedRevision, payloadVersion: 1, payload: {}, occurredAt: now };
  await enqueueAndCommit(action);
  return { ok: true };
}

export function postPresence(boardId: string, cursor?: { x: number; y: number }) {
  return api<{ users: CanvasPresenceUser[] }>(`/api/canvas/boards/${boardId}/events`, { method: 'POST', body: JSON.stringify({ cursor }) });
}

export type BoardEvent =
  | { type: 'board-updated'; board: CanvasBoard; byUserId: string }
  | { type: 'presence'; users: CanvasPresenceUser[] }
  | { type: 'board-deleted'; boardId: string; byUserId: string };

export function subscribeBoardEvents(boardId: string, onEvent: (event: BoardEvent) => void): () => void {
  const source = new EventSource(`/api/canvas/boards/${boardId}/events`, { withCredentials: true });
  source.onmessage = (message) => { try { onEvent(JSON.parse(message.data) as BoardEvent); } catch { /* ignore malformed */ } };
  return () => source.close();
}
