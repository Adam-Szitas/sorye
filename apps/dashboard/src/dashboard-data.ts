import type {
  EmbedWidget,
  HubSession,
  WorkspaceEventSettings,
  WorkspaceStorageInfo,
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

function parseCalendarEvents(raw: unknown): Array<{ title: string; dates?: string[]; date?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object');
}

function countUpcomingEvents(events: Array<{ dates?: string[]; date?: string }>): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 7);

  let count = 0;
  for (const event of events) {
    const dates = event.dates ?? (event.date ? [event.date] : []);
    for (const dateKey of dates) {
      const d = new Date(`${dateKey}T12:00:00`);
      if (d >= today && d <= horizon) count += 1;
    }
  }
  return count;
}

export function readLocalSnapshots(): LocalAppSnapshots {
  const calendarRaw = safeParse<unknown>(
    localStorage.getItem('sorye:calendar:events'),
    [],
  );
  const calendarEvents = parseCalendarEvents(calendarRaw);

  const tasksBoard = safeParse<{
    tasks?: Array<{ statusId: string; updatedAt: string; title: string }>;
  }>(localStorage.getItem('sorye:tasks:board'), {});
  const tasks = tasksBoard.tasks ?? [];
  const openTasks = tasks.filter((t) => t.statusId !== 'status-done').length;

  const notes = safeParse<unknown[]>(
    localStorage.getItem('sorye:notes:items'),
    [],
  );

  const relay = safeParse<{ messages?: Array<{ createdAt: string; title: string; sourceAppId: string }> }>(
    localStorage.getItem('sorye:relay:config'),
    {},
  );
  const relayMessages = relay.messages?.length ?? 0;

  return {
    calendarEvents: calendarEvents.length,
    upcomingEvents: countUpcomingEvents(calendarEvents),
    openTasks,
    totalTasks: tasks.length,
    notes: Array.isArray(notes) ? notes.length : 0,
    relayMessages,
  };
}

const SOURCE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  calendar: 'Calendar',
  notes: 'Notes',
  tasks: 'Tasks',
  relay: 'Relay',
};

export function buildActivityFeed(): ActivityItem[] {
  const items: ActivityItem[] = [];

  const tasksBoard = safeParse<{
    tasks?: Array<{ id: string; title: string; updatedAt: string }>;
  }>(localStorage.getItem('sorye:tasks:board'), {});
  for (const task of tasksBoard.tasks ?? []) {
    items.push({
      id: `task-${task.id}`,
      at: task.updatedAt,
      title: task.title,
      source: 'Tasks',
    });
  }

  const notes = safeParse<Array<{ id: string; title: string; updatedAt: string }>>(
    localStorage.getItem('sorye:notes:items'),
    [],
  );
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

  const calendarRaw = safeParse<unknown>(
    localStorage.getItem('sorye:calendar:events'),
    [],
  );
  for (const event of parseCalendarEvents(calendarRaw)) {
    const date = event.dates?.[0] ?? event.date;
    if (!date || !event.title) continue;
    items.push({
      id: `cal-${event.title}-${date}`,
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

  return {
    session,
    snapshots: readLocalSnapshots(),
    activity: buildActivityFeed(),
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
