import { CALENDAR_LOCAL_STORAGE_KEY } from '@sorye/types';
import {
  normalizeLegacyEvent,
  type CalendarEvent,
} from './event-schedule';

export type { CalendarEvent, EventKind } from './event-schedule';

export function createCalendarStorage() {
let revision = 0;
let conflicted = false;
let queue: Promise<void> = Promise.resolve();
const conflictDraftKey = 'sorye:calendar:conflict-draft:v1';
class ApiError extends Error {
  status: number;

  constructor(status: number, body: string) {
    super(body || `Request failed (${status})`);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (init?.method === "PUT") {
    if (conflicted) throw new Error("Another session changed this document. Your draft is kept; reload before merging changes.");
    init = { ...init, body: JSON.stringify({ ...JSON.parse(String(init.body)), expectedRevision: revision }) };
  }
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 409) {
    conflicted = true;
    try {
      const parsed = JSON.parse(String(init?.body)) as { events?: CalendarEvent[] };
      if (parsed.events) localStorage.setItem(conflictDraftKey, JSON.stringify({ savedAt: new Date().toISOString(), events: parsed.events }));
    } catch { /* The in-memory events remain available if browser storage is unavailable. */ }
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const text = typeof error.error === 'string' ? error.error : 'Could not save the workspace document.';
    throw new ApiError(res.status, text);
  }
  const data = await res.json();
  if (!Number.isInteger(data.revision)) throw new Error("Workspace response is missing a revision. Reload the app.");
  revision = data.revision;
  if (!init?.method) conflicted = false;
  return data as T;
}

function readLegacyEvents(): CalendarEvent[] | null {
  try {
    const raw = localStorage.getItem(CALENDAR_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const events = parsed
      .map(normalizeLegacyEvent)
      .filter((event): event is CalendarEvent => event !== null);
    return events;
  } catch {
    return null;
  }
}

function clearLegacyEvents() {
  try {
    localStorage.removeItem(CALENDAR_LOCAL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function loadEvents(): Promise<CalendarEvent[]> {
  const data = await api<{ events: CalendarEvent[]; empty: boolean }>(
    '/api/calendar',
  );
  if (data.empty) {
    const legacy = readLegacyEvents();
    if (legacy && legacy.length > 0) {
      const migrated = await api<{ events: CalendarEvent[] }>('/api/calendar', {
        method: 'PUT',
        body: JSON.stringify({ events: legacy, migrate: true }),
      });
      clearLegacyEvents();
      return migrated.events;
    }
    return data.events;
  }
  clearLegacyEvents();
  return data.events;
}

async function saveEvents(
  events: CalendarEvent[],
): Promise<CalendarEvent[]> {
  const saved = await api<{ events: CalendarEvent[] }>('/api/calendar', {
    method: 'PUT',
    body: JSON.stringify({ events }),
  });
  clearLegacyEvents();
  clearConflictDraft();
  return saved.events;
}

function readConflictDraft(): CalendarEvent[] | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(conflictDraftKey) ?? 'null') as { events?: unknown } | null;
    if (Array.isArray(parsed?.events)) return parsed.events as CalendarEvent[];
  } catch { /* ignore invalid local draft */ }
  return null;
}

function clearConflictDraft() {
  try { localStorage.removeItem(conflictDraftKey); } catch { /* ignore */ }
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

function api<T>(path: string, init?: RequestInit): Promise<T> {
  const run = queue.then(() => request<T>(path, init));
  queue = run.then(() => undefined, () => undefined);
  return run;
}

return { loadEvents, saveEvents, readConflictDraft, clearConflictDraft, isConflict };
}

export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function buildMonthGrid(viewDate: Date): Array<{
  dateKey: string;
  day: number;
  inMonth: boolean;
}> {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ dateKey: string; day: number; inMonth: boolean }> = [];

  for (let i = 0; i < 42; i++) {
    const dayNum = i - startOffset + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      const adj = dayNum < 1 ? dayNum : dayNum - daysInMonth;
      const adjDate = new Date(year, month + (dayNum < 1 ? -1 : 1), adj);
      cells.push({
        dateKey: toDateKey(
          adjDate.getFullYear(),
          adjDate.getMonth(),
          adjDate.getDate(),
        ),
        day: adjDate.getDate(),
        inMonth: false,
      });
    } else {
      cells.push({
        dateKey: toDateKey(year, month, dayNum),
        day: dayNum,
        inMonth: true,
      });
    }
  }

  return cells;
}
