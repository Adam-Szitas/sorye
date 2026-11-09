import { createDurableActionQueue, type DurableActionQueue } from '@sorye/platform';
import type { RodrigoAction, RodrigoActionBatchResult, UserLoadPartition, UserLoadWorkspace } from '@sorye/types';
import type { Note } from '@sorye/types';

export interface NotesSnapshot { notes: Note[]; empty: boolean; load?: UserLoadPartition<Note>; workspace?: UserLoadWorkspace; }
export type { Note };
export interface NotesQueueState { pending: number; failed: number; conflicts: number; rejected: number; }

export function createNotesStorage() {
  let activeScope: string | null = null;
  let notes = new Map<string, Note>();
  let revisions = new Map<string, number>();
  let load: UserLoadPartition<Note> | undefined;
  let workspace: UserLoadWorkspace | undefined;
  const queues = new Map<string, DurableActionQueue<RodrigoAction>>();
  let commitTail: Promise<void> = Promise.resolve();
  const conflictDraftKey = () => `sorye:notes:conflict-draft:v1:${activeScope ?? 'unscoped'}`;

  class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try { response = await fetch(path, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }); }
    catch { throw new ApiError(0, 'Rodrigo could not be reached. The note action remains queued in this browser.'); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = typeof data.error?.code === 'string' ? data.error.code : 'request_failed';
      throw new ApiError(response.status, code === 'rodrigo_unavailable' || response.status >= 500
        ? 'Rodrigo could not confirm this note change. It remains queued in this browser.' : `Note action failed (${code}).`);
    }
    return data as T;
  }

  async function getQueue() {
    const response = await request<{ queueScope: string }>('/api/notes/scope');
    if (!/^[a-f0-9]{64}$/.test(response.queueScope)) throw new Error('Hub returned an invalid Notes queue scope.');
    activeScope = response.queueScope;
    let current = queues.get(activeScope);
    if (!current) { current = createDurableActionQueue<RodrigoAction>({ appId: 'notes', scope: activeScope, maxRows: 500 }); queues.set(activeScope, current); }
    return current;
  }

  function saveConflictDraft(value: Note[]) {
    try { localStorage.setItem(conflictDraftKey(), JSON.stringify({ savedAt: new Date().toISOString(), notes: value })); } catch { /* IndexedDB queue remains authoritative for pending actions. */ }
  }

  async function readCollection(): Promise<NotesSnapshot> {
    const collected: Note[] = [];
    const nextRevisions = new Map<string, number>();
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ limit: '100' });
      if (cursor) params.set('cursor', cursor);
      const page = await request<{ items: Array<{ resourceId: string; revision: number; resource: Record<string, unknown> }>; nextCursor?: string | null }>(`/api/backend/resources/notes/note?${params}`);
      for (const item of page.items) {
        const note = item.resource as unknown as Note;
        collected.push(note);
        nextRevisions.set(item.resourceId, item.revision);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    notes = new Map(collected.map((note) => [note.id, note]));
    revisions = nextRevisions;
    return { notes: collected, empty: collected.length === 0, load, workspace };
  }

  async function flush(): Promise<void> {
    const q = await getQueue();
    const scope = activeScope!;
    const queued = await q.list();
    const candidates = queued.filter((item) => item.status === 'pending' || item.status === 'failed');
    if (!candidates.length) return;
    for (const item of candidates) await q.markAttempt(item.action.actionId);
    let result: RodrigoActionBatchResult;
    try { result = await request('/api/backend/actions/batch', { method: 'POST', headers: { 'X-Sorye-Queue-Scope': scope }, body: JSON.stringify({ actions: candidates.map((item) => item.action) }) }); }
    catch (error) {
      for (const item of candidates) await q.markTransportFailure(item.action.actionId, { code: 'rodrigo_unavailable', message: error instanceof Error ? error.message : 'Rodrigo could not be reached.' });
      throw error;
    }
    const outcomes = new Map(result.results.map((outcome) => [outcome.actionId, outcome]));
    for (const item of candidates) {
      const outcome = outcomes.get(item.action.actionId);
      if (!outcome) { await q.markTransportFailure(item.action.actionId, { code: 'missing_action_result', message: 'Rodrigo returned no result for this action.' }); continue; }
      await q.settle({ actionId: outcome.actionId, status: outcome.status, error: outcome.error });
      if (outcome.status === 'committed' || outcome.status === 'duplicate') {
        if (outcome.revision) revisions.set(item.action.resourceId, outcome.revision);
      } else if (outcome.status === 'conflict' || outcome.status === 'rejected') {
        const actionNote = item.action.payload as Partial<Note>;
        const draft = [...notes.values()].filter((note) => note.id !== item.action.resourceId);
        if (typeof actionNote.id === 'string' && typeof actionNote.title === 'string' && typeof actionNote.body === 'string' && typeof actionNote.updatedAt === 'string') draft.push(actionNote as Note);
        saveConflictDraft(draft);
      }
    }
  }

  async function loadSnapshot(): Promise<NotesSnapshot> {
    await getQueue();
    await flush().catch(() => undefined);
    return readCollection();
  }
  async function loadNotes(): Promise<Note[]> { return (await loadSnapshot()).notes; }

  async function saveNotes(next: Note[]): Promise<Note[]> {
    const previous = commitTail;
    let release: () => void = () => undefined;
    commitTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await commitNotes(next);
    } finally {
      release();
    }
  }

  async function commitNotes(next: Note[]): Promise<Note[]> {
    const q = await getQueue();
    const nextById = new Map(next.map((note) => [note.id, note]));
    const actions: RodrigoAction[] = [];
    const occurredAt = new Date().toISOString();
    for (const note of next) {
      const previous = notes.get(note.id);
      if (previous && JSON.stringify(previous) === JSON.stringify(note)) continue;
      actions.push({ actionId: crypto.randomUUID(), appId: 'notes', resourceType: 'note', operation: previous ? 'update' : 'create', resourceId: note.id,
        ...(previous ? { expectedRevision: revisions.get(note.id) ?? 1 } : {}), payloadVersion: 1,
        payload: { id: note.id, title: note.title, body: note.body, updatedAt: note.updatedAt }, occurredAt });
    }
    for (const [id] of notes) if (!nextById.has(id)) actions.push({ actionId: crypto.randomUUID(), appId: 'notes', resourceType: 'note', operation: 'delete', resourceId: id, expectedRevision: revisions.get(id) ?? 1, payloadVersion: 1, payload: {}, occurredAt });
    // Persist all user intent before the network request starts.
    for (const action of actions) await q.enqueue(action);
    notes = nextById;
    await flush();
    const remaining = await q.list();
    if (remaining.some((item) => item.status === 'conflict')) throw new ApiError(409, 'A note changed in another session. Reload and reconcile the saved draft.');
    if (remaining.some((item) => item.status !== 'pending' && item.status !== 'failed')) throw new ApiError(400, 'Rodrigo rejected a note action. Review and reconcile it before continuing.');
    if (remaining.length) throw new ApiError(503, 'Rodrigo has not confirmed every note change. Use Resend when the connection is available.');
    clearConflictDraft();
    return next;
  }

  async function queueState(): Promise<NotesQueueState> {
    const items = await (await getQueue()).list();
    return { pending: items.filter((item) => item.status === 'pending').length, failed: items.filter((item) => item.status === 'failed').length, conflicts: items.filter((item) => item.status === 'conflict').length, rejected: items.filter((item) => item.status === 'rejected').length };
  }
  async function resendPending() { await flush(); }
  async function discardConflictsAndRejected() {
    const q = await getQueue();
    for (const item of await q.list()) if (item.status === 'conflict' || item.status === 'rejected') await q.discard(item.action.actionId);
  }
  function readConflictDraft(): Note[] | null { try { const data = JSON.parse(localStorage.getItem(conflictDraftKey()) ?? 'null') as { notes?: unknown } | null; return Array.isArray(data?.notes) ? data.notes as Note[] : null; } catch { return null; } }
  function clearConflictDraft() { try { localStorage.removeItem(conflictDraftKey()); } catch { /* optional draft */ } }
  function isConflict(error: unknown) { return error instanceof ApiError && error.status === 409; }
  return { loadNotes, loadSnapshot, saveNotes, readConflictDraft, clearConflictDraft, isConflict, queueState, resendPending, discardConflictsAndRejected };
}
