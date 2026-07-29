export type EventKind = 'timed' | 'allDay' | 'multiDate';

export interface CalendarEvent {
  id: string;
  title: string;
  kind: EventKind;
  dates: string[];
  startTime?: string;
  endTime?: string;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function compareTimes(a: string, b: string): number {
  return a.localeCompare(b);
}

export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const nh = Math.floor(wrapped / 60);
  const nm = wrapped % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

export function defaultEndTime(startTime: string): string {
  return addMinutesToTime(startTime, 60);
}

export function normalizeLegacyEvent(raw: unknown): CalendarEvent | null {
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
      kind: record.kind as EventKind,
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
      endTime: defaultEndTime(startTime),
    };
  }

  return null;
}

export function eventOccursOnDate(event: CalendarEvent, dateKey: string): boolean {
  return event.dates.includes(dateKey);
}

export function formatEventSchedule(event: CalendarEvent): string {
  if (event.kind === 'allDay') return 'All day';
  if (event.kind === 'multiDate') {
    const range =
      event.startTime && event.endTime
        ? `${event.startTime} – ${event.endTime}`
        : 'All day';
    const dayLabel =
      event.dates.length === 1
        ? '1 day'
        : `${event.dates.length} days`;
    return `${range} · ${dayLabel}`;
  }
  if (event.startTime && event.endTime) {
    return `${event.startTime} – ${event.endTime}`;
  }
  return event.startTime ?? 'Timed';
}

export function sortEventsForDay(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => {
    if (a.kind === 'allDay' && b.kind !== 'allDay') return -1;
    if (b.kind === 'allDay' && a.kind !== 'allDay') return 1;
    const aStart = a.startTime ?? '99:99';
    const bStart = b.startTime ?? '99:99';
    return aStart.localeCompare(bStart);
  });
}

export function validateTimedRange(startTime: string, endTime: string): string | null {
  if (!isValidTime(startTime) || !isValidTime(endTime)) {
    return 'Enter valid start and end times.';
  }
  if (compareTimes(endTime, startTime) <= 0) {
    return 'End time must be after start time.';
  }
  return null;
}
