import {

  normalizeLegacyEvent,

  type CalendarEvent,

} from './event-schedule';



export type { CalendarEvent, EventKind } from './event-schedule';



const STORAGE_KEY = 'sorye:calendar:events';



export function loadEvents(): CalendarEvent[] {

  try {

    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) return seedEvents();

    const parsed = JSON.parse(raw) as unknown[];

    if (!Array.isArray(parsed)) return seedEvents();

    const events = parsed

      .map(normalizeLegacyEvent)

      .filter((event): event is CalendarEvent => event !== null);

    return events.length > 0 ? events : seedEvents();

  } catch {

    return seedEvents();

  }

}



export function saveEvents(events: CalendarEvent[]) {

  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));

}



function seedEvents(): CalendarEvent[] {

  const today = new Date();

  const date = toDateKey(

    today.getFullYear(),

    today.getMonth(),

    today.getDate(),

  );

  return [

    {

      id: 'evt-seed-1',

      title: 'Welcome to Sorye Calendar',

      kind: 'timed',

      dates: [date],

      startTime: '09:00',

      endTime: '10:00',

    },

  ];

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


