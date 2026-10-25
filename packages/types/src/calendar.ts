/** Shared Calendar models for Hub API + Calendar remote. */

export type CalendarEventKind = 'timed' | 'allDay' | 'multiDate';

export interface CalendarEvent {
  id: string;
  title: string;
  kind: CalendarEventKind;
  dates: string[];
  startTime?: string;
  endTime?: string;
}

/** Browser key used only for one-time migrate off localStorage. */
export const CALENDAR_LOCAL_STORAGE_KEY = 'sorye:calendar:events';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const nh = Math.floor(wrapped / 60);
  const nm = wrapped % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

/** Accept current events plus the older `{ date, time }` shape from localStorage. */
export function normalizeLegacyCalendarEvent(raw: unknown): CalendarEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  if (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    Array.isArray(record.dates) &&
    typeof record.kind === 'string'
  ) {
    const dates = record.dates.filter((d): d is string => typeof d === 'string');
    if (dates.length === 0) return null;
    return {
      id: record.id,
      title: record.title,
      kind: record.kind as CalendarEventKind,
      dates: [...new Set(dates)].sort(),
      startTime:
        typeof record.startTime === 'string' ? record.startTime : undefined,
      endTime: typeof record.endTime === 'string' ? record.endTime : undefined,
    };
  }

  if (typeof record.id === 'string' && typeof record.title === 'string') {
    const date = typeof record.date === 'string' ? record.date : null;
    if (!date) return null;
    const startTime =
      typeof record.time === 'string' && isValidTime(record.time)
        ? record.time
        : '09:00';
    return {
      id: record.id,
      title: record.title,
      kind: 'timed',
      dates: [date],
      startTime,
      endTime: addMinutesToTime(startTime, 60),
    };
  }

  return null;
}
