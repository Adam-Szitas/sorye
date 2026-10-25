import {
  normalizeLegacyCalendarEvent,
  type CalendarEvent,
  type Note,
  type TaskItem,
  type TaskStatus,
  type TasksBoard,
} from '@sorye/types';
import {
  MAX_CALENDAR_BYTES,
  MAX_CALENDAR_DATES,
  MAX_CALENDAR_EVENTS,
  MAX_CALENDAR_TITLE_LENGTH,
  MAX_NOTE_BODY_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  MAX_NOTES,
  MAX_NOTES_BYTES,
  MAX_TASK_BODY_LENGTH,
  MAX_TASK_STATUSES,
  MAX_TASK_TITLE_LENGTH,
  MAX_TASKS,
  MAX_TASKS_BOARD_BYTES,
  assertJsonPayloadSize,
} from '@/lib/security-limits';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ID_RE = /^[\w.-]{1,80}$/;

function assertStringId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertIso(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return new Date(value).toISOString();
}

function isTaskStatus(value: unknown): value is TaskStatus {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.color === 'string' &&
    typeof record.order === 'number' &&
    Number.isInteger(record.order)
  );
}

function isTaskItem(value: unknown): value is TaskItem {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.body === 'string' &&
    typeof record.statusId === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  );
}

export function parseTasksBoard(raw: unknown): TasksBoard {
  assertJsonPayloadSize(raw, MAX_TASKS_BOARD_BYTES, 'Tasks board');
  if (!raw || typeof raw !== 'object') {
    throw new Error('Tasks board is required');
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.statuses) || !Array.isArray(record.tasks)) {
    throw new Error('Tasks board must include statuses and tasks');
  }

  const statuses = record.statuses.filter(isTaskStatus);
  if (statuses.length === 0) {
    throw new Error('Tasks board needs at least one status');
  }
  if (statuses.length > MAX_TASK_STATUSES) {
    throw new Error(`Tasks board cannot exceed ${MAX_TASK_STATUSES} statuses`);
  }

  const seenStatusIds = new Set<string>();
  const normalizedStatuses = statuses.map((status) => {
    const id = assertStringId(status.id, 'Status id');
    if (seenStatusIds.has(id)) throw new Error('Duplicate status id');
    seenStatusIds.add(id);
    const name = status.name.trim();
    if (!name || name.length > MAX_TASK_TITLE_LENGTH) {
      throw new Error('Status name is invalid');
    }
    if (!COLOR_RE.test(status.color)) {
      throw new Error('Status color must be a hex value');
    }
    if (status.order < 0 || status.order > 10_000) {
      throw new Error('Status order is invalid');
    }
    return { ...status, id, name };
  });

  const tasks = record.tasks.filter(isTaskItem);
  if (tasks.length > MAX_TASKS) {
    throw new Error(`Tasks board cannot exceed ${MAX_TASKS} tasks`);
  }

  const fallbackStatusId = normalizedStatuses[0].id;
  const seenTaskIds = new Set<string>();
  const normalizedTasks = tasks.map((task) => {
    const id = assertStringId(task.id, 'Task id');
    if (seenTaskIds.has(id)) throw new Error('Duplicate task id');
    seenTaskIds.add(id);
    const title = task.title.trim();
    if (!title || title.length > MAX_TASK_TITLE_LENGTH) {
      throw new Error('Task title is invalid');
    }
    if (task.body.length > MAX_TASK_BODY_LENGTH) {
      throw new Error('Task notes are too long');
    }
    assertIso(task.createdAt, 'Task createdAt');
    assertIso(task.updatedAt, 'Task updatedAt');
    const statusId = seenStatusIds.has(task.statusId)
      ? task.statusId
      : fallbackStatusId;
    return { ...task, id, title, statusId };
  });

  return { statuses: normalizedStatuses, tasks: normalizedTasks };
}

export function parseNotes(raw: unknown): Note[] {
  assertJsonPayloadSize(raw, MAX_NOTES_BYTES, 'Notes');
  if (!Array.isArray(raw)) {
    throw new Error('Notes must be an array');
  }
  if (raw.length > MAX_NOTES) {
    throw new Error(`Cannot store more than ${MAX_NOTES} notes`);
  }

  const seen = new Set<string>();
  return raw.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Note is invalid');
    }
    const record = item as Record<string, unknown>;
    const id = assertStringId(record.id, 'Note id');
    if (seen.has(id)) throw new Error('Duplicate note id');
    seen.add(id);
    if (typeof record.title !== 'string' || record.title.length > MAX_NOTE_TITLE_LENGTH) {
      throw new Error('Note title is invalid');
    }
    if (typeof record.body !== 'string' || record.body.length > MAX_NOTE_BODY_LENGTH) {
      throw new Error('Note body is too long');
    }
    return {
      id,
      title: record.title,
      body: record.body,
      updatedAt: assertIso(record.updatedAt, 'Note updatedAt'),
    };
  });
}

export function parseCalendarEvents(raw: unknown): CalendarEvent[] {
  assertJsonPayloadSize(raw, MAX_CALENDAR_BYTES, 'Calendar');
  if (!Array.isArray(raw)) {
    throw new Error('Calendar events must be an array');
  }
  if (raw.length > MAX_CALENDAR_EVENTS) {
    throw new Error(`Cannot store more than ${MAX_CALENDAR_EVENTS} events`);
  }

  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const item of raw) {
    const event = normalizeLegacyCalendarEvent(item);
    if (!event) throw new Error('Calendar event is invalid');
    const id = assertStringId(event.id, 'Event id');
    if (seen.has(id)) throw new Error('Duplicate event id');
    seen.add(id);
    const title = event.title.trim();
    if (!title || title.length > MAX_CALENDAR_TITLE_LENGTH) {
      throw new Error('Event title is invalid');
    }
    if (
      event.kind !== 'timed' &&
      event.kind !== 'allDay' &&
      event.kind !== 'multiDate'
    ) {
      throw new Error('Event kind is invalid');
    }
    if (event.dates.length === 0 || event.dates.length > MAX_CALENDAR_DATES) {
      throw new Error('Event dates are invalid');
    }
    if (event.dates.some((date) => !DATE_KEY_RE.test(date))) {
      throw new Error('Event date must be YYYY-MM-DD');
    }
    if (event.startTime && !TIME_RE.test(event.startTime)) {
      throw new Error('Event start time is invalid');
    }
    if (event.endTime && !TIME_RE.test(event.endTime)) {
      throw new Error('Event end time is invalid');
    }
    events.push({ ...event, id, title, dates: [...new Set(event.dates)].sort() });
  }
  return events;
}
