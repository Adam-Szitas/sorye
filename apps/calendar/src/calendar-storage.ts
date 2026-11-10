import { createDurableActionQueue, getLocale, translate, type DurableActionQueue, type MessageKey, type MessageParams } from '@sorye/platform';
import type { RodrigoAction, RodrigoActionBatchResult, UserLoadPartition, UserLoadWorkspace } from '@sorye/types';
import { normalizeLegacyEvent, type CalendarEvent } from './event-schedule';

export type { CalendarEvent, EventKind } from './event-schedule';
const tr = (key: MessageKey, params?: MessageParams) => translate(getLocale(), key, params);

export interface CalendarQueueState { pending: number; failed: number; conflicts: number; rejected: number; }

export function createCalendarStorage() {
  let activeScope: string | null = null;
  let events = new Map<string, CalendarEvent>();
  let revisions = new Map<string, number>();
  let lastLoad: UserLoadPartition<CalendarEvent> | null = null;
  let lastWorkspace: UserLoadWorkspace | null = null;
  const queues = new Map<string, DurableActionQueue<RodrigoAction>>();
  const conflictDraftKey = () => `sorye:calendar:conflict-draft:v1:${activeScope ?? 'unscoped'}`;
  class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try { response = await fetch(path, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }); }
    catch { throw new ApiError(0, tr('calendar.err.unreachable')); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = typeof data.error?.code === 'string' ? data.error.code : 'request_failed';
      throw new ApiError(response.status, code === 'rodrigo_unavailable' || response.status >= 500
        ? tr('calendar.err.unconfirmed') : tr('calendar.err.actionFailed', { code }));
    }
    return data as T;
  }

  async function getQueue() {
    const response = await request<{ queueScope: string }>('/api/calendar/scope');
    if (!/^[a-f0-9]{64}$/.test(response.queueScope)) throw new Error(tr('calendar.err.invalidScope'));
    activeScope = response.queueScope;
    let current = queues.get(activeScope);
    if (!current) { current = createDurableActionQueue<RodrigoAction>({ appId: 'calendar', scope: activeScope, maxRows: 500 }); queues.set(activeScope, current); }
    return current;
  }

  function saveConflictDraft(value: CalendarEvent[]) {
    try { localStorage.setItem(conflictDraftKey(), JSON.stringify({ savedAt: new Date().toISOString(), events: value })); } catch { /* IndexedDB queue remains authoritative for pending actions. */ }
  }

  async function readCollection(): Promise<CalendarEvent[]> {
    const collected: CalendarEvent[] = [];
    const nextRevisions = new Map<string, number>();
    let cursor: string | undefined;
    do {
      const params = new URLSearchParams({ limit: '100' });
      if (cursor) params.set('cursor', cursor);
      const page = await request<{ items: Array<{ resourceId: string; revision: number; resource: Record<string, unknown> }>; nextCursor?: string | null }>(`/api/backend/resources/calendar/event?${params}`);
      for (const item of page.items) {
        const event = normalizeLegacyEvent(item.resource);
        if (!event) continue;
        collected.push(event);
        nextRevisions.set(item.resourceId, item.revision);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    events = new Map(collected.map((event) => [event.id, event]));
    revisions = nextRevisions;
    return collected;
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
      for (const item of candidates) await q.markTransportFailure(item.action.actionId, { code: 'rodrigo_unavailable', message: error instanceof Error ? error.message : tr('calendar.err.unreachableShort') });
      throw error;
    }
    const outcomes = new Map(result.results.map((outcome) => [outcome.actionId, outcome]));
    for (const item of candidates) {
      const outcome = outcomes.get(item.action.actionId);
      if (!outcome) { await q.markTransportFailure(item.action.actionId, { code: 'missing_action_result', message: tr('calendar.err.noResult') }); continue; }
      await q.settle({ actionId: outcome.actionId, status: outcome.status, error: outcome.error });
      if ((outcome.status === 'committed' || outcome.status === 'duplicate') && outcome.revision) revisions.set(item.action.resourceId, outcome.revision);
      else if (outcome.status === 'conflict' || outcome.status === 'rejected') {
        const actionEvent = normalizeLegacyEvent(item.action.payload);
        const draft = [...events.values()].filter((event) => event.id !== item.action.resourceId);
        if (actionEvent) draft.push(actionEvent);
        saveConflictDraft(draft);
      }
    }
  }

  async function loadEvents(): Promise<CalendarEvent[]> {
    await getQueue();
    await flush().catch(() => undefined);
    lastLoad = null;
    lastWorkspace = null;
    return readCollection();
  }

  async function saveEvents(next: CalendarEvent[]): Promise<CalendarEvent[]> {
    const q = await getQueue();
    const nextById = new Map(next.map((event) => [event.id, event]));
    const actions: RodrigoAction[] = [];
    const occurredAt = new Date().toISOString();
    const payload = (event: CalendarEvent) => ({ id: event.id, title: event.title, kind: event.kind, dates: event.dates, ...(event.startTime ? { startTime: event.startTime } : {}), ...(event.endTime ? { endTime: event.endTime } : {}) });
    for (const event of next) {
      const previous = events.get(event.id);
      if (previous && JSON.stringify(previous) === JSON.stringify(event)) continue;
      actions.push({ actionId: crypto.randomUUID(), appId: 'calendar', resourceType: 'event', operation: previous ? 'update' : 'create', resourceId: event.id,
        ...(previous ? { expectedRevision: revisions.get(event.id) ?? 1 } : {}), payloadVersion: 1, payload: payload(event), occurredAt });
    }
    for (const [id] of events) if (!nextById.has(id)) actions.push({ actionId: crypto.randomUUID(), appId: 'calendar', resourceType: 'event', operation: 'delete', resourceId: id, expectedRevision: revisions.get(id) ?? 1, payloadVersion: 1, payload: {}, occurredAt });
    for (const action of actions) await q.enqueue(action);
    events = nextById;
    await flush();
    const remaining = await q.list();
    if (remaining.some((item) => item.status === 'conflict')) throw new ApiError(409, 'A calendar event changed in another session. Reload and reconcile the saved draft.');
    if (remaining.some((item) => item.status !== 'pending' && item.status !== 'failed')) throw new ApiError(400, tr('calendar.err.rejected'));
    if (remaining.length) throw new ApiError(503, tr('calendar.err.notConfirmedAll'));
    clearConflictDraft();
    return next;
  }

  async function queueState(): Promise<CalendarQueueState> {
    const items = await (await getQueue()).list();
    return { pending: items.filter((item) => item.status === 'pending').length, failed: items.filter((item) => item.status === 'failed').length, conflicts: items.filter((item) => item.status === 'conflict').length, rejected: items.filter((item) => item.status === 'rejected').length };
  }
  async function resendPending() { await flush(); }
  async function discardConflictsAndRejected() {
    const q = await getQueue();
    for (const item of await q.list()) if (item.status === 'conflict' || item.status === 'rejected') await q.discard(item.action.actionId);
  }
  function readConflictDraft(): CalendarEvent[] | null { try { const data = JSON.parse(localStorage.getItem(conflictDraftKey()) ?? 'null') as { events?: unknown } | null; return Array.isArray(data?.events) ? data.events as CalendarEvent[] : null; } catch { return null; } }
  function clearConflictDraft() { try { localStorage.removeItem(conflictDraftKey()); } catch { /* optional draft */ } }
  function isConflict(error: unknown) { return error instanceof ApiError && error.status === 409; }
  return { loadEvents, saveEvents, readConflictDraft, clearConflictDraft, isConflict, queueState, resendPending, discardConflictsAndRejected, readLoad: () => ({ load: lastLoad, workspace: lastWorkspace }) };
}

export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfMonth(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), 1); }
export function addMonths(date: Date, delta: number): Date { return new Date(date.getFullYear(), date.getMonth() + delta, 1); }
/** Monday-first short weekday names in the active language. */
export function weekdayLabels(locale: string = getLocale()): string[] {
  return Array.from({ length: 7 }, (_, index) => new Date(2024, 0, 1 + index).toLocaleDateString(locale, { weekday: 'short' }));
}

export function buildMonthGrid(viewDate: Date): Array<{ dateKey: string; day: number; inMonth: boolean }> {
  const year = viewDate.getFullYear(); const month = viewDate.getMonth();
  const first = new Date(year, month, 1); const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ dateKey: string; day: number; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const dayNum = i - startOffset + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      const adj = dayNum < 1 ? dayNum : dayNum - daysInMonth;
      const date = new Date(year, month + (dayNum < 1 ? -1 : 1), adj);
      cells.push({ dateKey: toDateKey(date.getFullYear(), date.getMonth(), date.getDate()), day: date.getDate(), inMonth: false });
    } else cells.push({ dateKey: toDateKey(year, month, dayNum), day: dayNum, inMonth: true });
  }
  return cells;
}
