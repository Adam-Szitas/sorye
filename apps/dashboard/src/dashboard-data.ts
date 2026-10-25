import {
  CALENDAR_LOCAL_STORAGE_KEY,
  NOTES_LOCAL_STORAGE_KEY,
  TASKS_LOCAL_STORAGE_KEY,
  type CalendarEvent,
  type EmbedWidget,
  type HubSession,
  type Note,
  type TasksBoard,
  type WorkspaceEventSettings,
  type WorkspaceStorageInfo,
} from '@sorye/types';

export interface EventsStatus {
  eligible: boolean;
  enabled: boolean;
  alive: boolean;
  settings: WorkspaceEventSettings;
  eventsChannel: string;
  selectedAppCount: number;
  hasMessenger: boolean;
}

export interface LocalAppSnapshots {
  calendarEvents: number;
  upcomingEvents: number;
  openTasks: number;
  totalTasks: number;
  notes: number;
  relayMessages: number;
}

export interface ActivityItem {
  id: string;
  at: string;
  title: string;
  source: string;
}

export interface DashboardData {
  session: HubSession;
  snapshots: LocalAppSnapshots;
  activity: ActivityItem[];
  widgets: EmbedWidget[];
  storage: WorkspaceStorageInfo | null;
  events: EventsStatus | null;
  hubOrigin: string;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function countUpcomingEvents(events: CalendarEvent[]): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 7);

  let count = 0;
  for (const event of events) {
    for (const dateKey of event.dates) {
      const d = new Date(`${dateKey}T12:00:00`);
      if (d >= today && d <= horizon) count += 1;
    }
  }
  return count;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(path, {
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function migrateTasksIfNeeded(): Promise<TasksBoard | null> {
  const data = await fetchJson<{ board: TasksBoard; empty: boolean }>('/api/tasks');
  if (!data) return null;
  if (data.empty) {
    const legacy = safeParse<TasksBoard | null>(
      localStorage.getItem(TASKS_LOCAL_STORAGE_KEY),
      null,
    );
    if (legacy?.statuses?.length) {
      const migrated = await fetchJson<{ board: TasksBoard }>('/api/tasks', {
        method: 'PUT',
        body: JSON.stringify({ board: legacy, migrate: true }),
      });
      localStorage.removeItem(TASKS_LOCAL_STORAGE_KEY);
      return migrated?.board ?? legacy;
    }
    return data.board;
  }
  localStorage.removeItem(TASKS_LOCAL_STORAGE_KEY);
  return data.board;
}

async function migrateNotesIfNeeded(): Promise<Note[]> {
  const data = await fetchJson<{ notes: Note[]; empty: boolean }>('/api/notes');
  if (!data) return [];
  if (data.empty) {
    const legacy = safeParse<Note[]>(
      localStorage.getItem(NOTES_LOCAL_STORAGE_KEY),
      [],
    );
    if (legacy.length > 0) {
      const migrated = await fetchJson<{ notes: Note[] }>('/api/notes', {
        method: 'PUT',
        body: JSON.stringify({ notes: legacy, migrate: true }),
      });
      localStorage.removeItem(NOTES_LOCAL_STORAGE_KEY);
      return migrated?.notes ?? legacy;
    }
    return data.notes;
  }
  localStorage.removeItem(NOTES_LOCAL_STORAGE_KEY);
  return data.notes;
}

async function migrateCalendarIfNeeded(): Promise<CalendarEvent[]> {
  const data = await fetchJson<{ events: CalendarEvent[]; empty: boolean }>(
    '/api/calendar',
  );
  if (!data) return [];
  if (data.empty) {
    const legacy = safeParse<CalendarEvent[]>(
      localStorage.getItem(CALENDAR_LOCAL_STORAGE_KEY),
      [],
    );
    if (legacy.length > 0) {
      const migrated = await fetchJson<{ events: CalendarEvent[] }>(
        '/api/calendar',
        {
          method: 'PUT',
          body: JSON.stringify({ events: legacy, migrate: true }),
        },
      );
      localStorage.removeItem(CALENDAR_LOCAL_STORAGE_KEY);
      return migrated?.events ?? legacy;
    }
    return data.events;
  }
  localStorage.removeItem(CALENDAR_LOCAL_STORAGE_KEY);
  return data.events;
}

function buildSnapshots(
  board: TasksBoard | null,
  notes: Note[],
  events: CalendarEvent[],
): LocalAppSnapshots {
  const tasks = board?.tasks ?? [];
  const openTasks = tasks.filter((t) => t.statusId !== 'status-done').length;
  const relay = safeParse<{
    messages?: Array<{ createdAt: string; title: string; sourceAppId: string }>;
  }>(localStorage.getItem('sorye:relay:config'), {});

  return {
    calendarEvents: events.length,
    upcomingEvents: countUpcomingEvents(events),
    openTasks,
    totalTasks: tasks.length,
    notes: notes.length,
    relayMessages: relay.messages?.length ?? 0,
  };
}

const SOURCE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  calendar: 'Calendar',
  notes: 'Notes',
  tasks: 'Tasks',
  relay: 'Relay',
};

function buildActivityFeed(
  board: TasksBoard | null,
  notes: Note[],
  events: CalendarEvent[],
): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const task of board?.tasks ?? []) {
    items.push({
      id: `task-${task.id}`,
      at: task.updatedAt,
      title: task.title,
      source: 'Tasks',
    });
  }

  for (const note of notes) {
    items.push({
      id: `note-${note.id}`,
      at: note.updatedAt,
      title: note.title || 'Untitled note',
      source: 'Notes',
    });
  }

  const relay = safeParse<{
    messages?: Array<{
      id: string;
      title: string;
      createdAt: string;
      sourceAppId: string;
    }>;
  }>(localStorage.getItem('sorye:relay:config'), {});
  for (const message of relay.messages ?? []) {
    items.push({
      id: `relay-${message.id}`,
      at: message.createdAt,
      title: message.title,
      source: SOURCE_LABELS[message.sourceAppId] ?? 'Relay',
    });
  }

  for (const event of events) {
    const date = event.dates[0];
    if (!date || !event.title) continue;
    items.push({
      id: `cal-${event.id}`,
      at: `${date}T09:00:00.000Z`,
      title: event.title,
      source: 'Calendar',
    });
  }

  return items
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);
}

export async function loadDashboardData(): Promise<DashboardData> {
  const res = await fetch('/api/workspace', { credentials: 'include' });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? 'Sign in through the Hub to load workspace data.'
        : 'Could not load workspace data from the Hub.',
    );
  }

  const session = (await res.json()) as HubSession;

  let widgets: EmbedWidget[] = [];
  try {
    const widgetsRes = await fetch('/api/embed/widgets', {
      credentials: 'include',
    });
    if (widgetsRes.ok) {
      const data = (await widgetsRes.json()) as { widgets: EmbedWidget[] };
      widgets = data.widgets ?? [];
    }
  } catch {
    widgets = [];
  }

  let storage: WorkspaceStorageInfo | null = null;
  try {
    const storageRes = await fetch('/api/workspace/storage', {
      credentials: 'include',
    });
    if (storageRes.ok) {
      const data = (await storageRes.json()) as {
        storage: WorkspaceStorageInfo;
      };
      storage = data.storage ?? null;
    }
  } catch {
    storage = null;
  }

  let events: EventsStatus | null = null;
  try {
    const eventsRes = await fetch('/api/events', { credentials: 'include' });
    if (eventsRes.ok) {
      events = (await eventsRes.json()) as EventsStatus;
    }
  } catch {
    events = null;
  }

  const [board, notes, calendarEvents] = await Promise.all([
    migrateTasksIfNeeded(),
    migrateNotesIfNeeded(),
    migrateCalendarIfNeeded(),
  ]);

  return {
    session,
    snapshots: buildSnapshots(board, notes, calendarEvents),
    activity: buildActivityFeed(board, notes, calendarEvents),
    widgets,
    storage,
    events,
    hubOrigin: window.location.origin,
  };
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
