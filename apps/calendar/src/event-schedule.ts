import {
  normalizeLegacyCalendarEvent,
  type CalendarEvent,
  type CalendarEventKind,
} from '@sorye/types';

export type EventKind = CalendarEventKind;
export type { CalendarEvent };

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
  return normalizeLegacyCalendarEvent(raw);
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
