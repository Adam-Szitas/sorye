import { useCallback, useMemo, useState } from 'react';

import {
  addMonths,
  buildMonthGrid,
  loadEvents,
  parseDateKey,
  saveEvents,
  toDateKey,
  type CalendarEvent,
} from './calendar-storage';
import {
  eventOccursOnDate,
  formatEventSchedule,
  sortEventsForDay,
} from './event-schedule';
import { emitWorkspaceEvent } from './emit-event';

import {

  buildInitialDraft,

  EventForm,

  type ScheduleDraft,

} from './event-form';

import './styles.css';



function todayKey(): string {

  const now = new Date();

  return toDateKey(now.getFullYear(), now.getMonth(), now.getDate());

}



function toggleDateInList(dates: string[], dateKey: string): string[] {

  if (dates.includes(dateKey)) {

    const next = dates.filter((d) => d !== dateKey);

    return next.length > 0 ? next : [dateKey];

  }

  return [...dates, dateKey].sort();

}



export default function App() {

  const [viewDate, setViewDate] = useState(() => {

    const now = new Date();

    return new Date(now.getFullYear(), now.getMonth(), 1);

  });

  const [selectedDate, setSelectedDate] = useState(todayKey);

  const [events, setEvents] = useState<CalendarEvent[]>(() => loadEvents());

  const [draft, setDraft] = useState<ScheduleDraft>(() =>

    buildInitialDraft(todayKey()),

  );



  const monthLabel = viewDate.toLocaleDateString(undefined, {

    month: 'long',

    year: 'numeric',

  });



  const grid = useMemo(() => buildMonthGrid(viewDate), [viewDate]);



  const eventsByDate = useMemo(() => {

    const map = new Map<string, CalendarEvent[]>();

    for (const event of events) {

      for (const dateKey of event.dates) {

        const list = map.get(dateKey) ?? [];

        list.push(event);

        map.set(dateKey, list);

      }

    }

    return map;

  }, [events]);



  const dayEvents = (eventsByDate.get(selectedDate) ?? []).filter((event) =>

    eventOccursOnDate(event, selectedDate),

  );



  const persist = useCallback((next: CalendarEvent[]) => {
    setEvents(next);
    saveEvents(next);
  }, []);

  const handleDayClick = (dateKey: string) => {

    setSelectedDate(dateKey);

    if (draft.kind === 'multiDate') {

      setDraft((current) => ({

        ...current,

        dates: toggleDateInList(current.dates, dateKey),

      }));

      return;

    }

    setDraft((current) => ({

      ...current,

      dates: [dateKey],

    }));

  };



  const addEvent = (event: Omit<CalendarEvent, 'id'>) => {
    const created: CalendarEvent = {
      ...event,
      id: `evt-${crypto.randomUUID().slice(0, 8)}`,
    };
    persist([...events, created]);
    void emitWorkspaceEvent('sorye.calendar.saved', {
      title: `Calendar: ${created.title}`,
      summary: formatEventSchedule(created),
      appId: 'calendar',
      entityId: created.id,
    });
    setDraft(buildInitialDraft(selectedDate));
  };

  const removeEvent = (id: string) => {
    const removed = events.find((e) => e.id === id);
    persist(events.filter((e) => e.id !== id));
    if (removed) {
      void emitWorkspaceEvent('sorye.calendar.saved', {
        title: `Calendar removed: ${removed.title}`,
        summary: formatEventSchedule(removed),
        appId: 'calendar',
        entityId: removed.id,
      });
    }
  };



  const multiPickActive = draft.kind === 'multiDate';



  return (

    <div className="calendar-app">

      <header className="calendar-header">

        <div>

          <h1>Calendar</h1>

          <p>Plan meetings and deadlines in your workspace</p>

        </div>

        <span className="calendar-badge">Productivity</span>

      </header>



      <div className="calendar-layout">

        <section className="calendar-panel">

          <div className="calendar-month-toolbar">

            <button

              type="button"

              className="btn-ghost"

              onClick={() => setViewDate((d) => addMonths(d, -1))}

            >

              ←

            </button>

            <h2>{monthLabel}</h2>

            <button

              type="button"

              className="btn-ghost"

              onClick={() => setViewDate((d) => addMonths(d, 1))}

            >

              →

            </button>

          </div>



          {multiPickActive ? (

            <p className="calendar-pick-hint">

              Multi-day mode: click days to add or remove them from the event.

            </p>

          ) : null}



          <div className="calendar-weekdays">

            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (

              <span key={d}>{d}</span>

            ))}

          </div>



          <div className="calendar-grid">

            {grid.map((cell) => {

              const count = eventsByDate.get(cell.dateKey)?.length ?? 0;

              const isSelected = cell.dateKey === selectedDate;

              const isPicked =

                multiPickActive && draft.dates.includes(cell.dateKey);

              const isToday = cell.dateKey === todayKey();

              return (

                <button

                  key={cell.dateKey}

                  type="button"

                  className={[

                    'calendar-day',

                    !cell.inMonth && 'muted',

                    isSelected && 'selected',

                    isPicked && 'picked',

                    isToday && 'today',

                  ]

                    .filter(Boolean)

                    .join(' ')}

                  onClick={() => handleDayClick(cell.dateKey)}

                >

                  <span>{cell.day}</span>

                  {count > 0 ? <em>{count}</em> : null}

                </button>

              );

            })}

          </div>

        </section>



        <div className="calendar-side">

          <section className="calendar-panel">

            <h2 className="panel-title">

              {parseDateKey(selectedDate).toLocaleDateString(undefined, {

                weekday: 'long',

                month: 'long',

                day: 'numeric',

              })}

            </h2>



            {dayEvents.length === 0 ? (

              <p className="calendar-empty">No events yet.</p>

            ) : (

              <ul className="calendar-events">

                {sortEventsForDay(dayEvents).map((event) => (

                  <li key={event.id}>

                    <div>

                      <strong>{event.title}</strong>

                      <span>{formatEventSchedule(event)}</span>

                      {event.kind === 'multiDate' && event.dates.length > 1 ? (

                        <small>{event.dates.length} days</small>

                      ) : null}

                    </div>

                    <button

                      type="button"

                      className="btn-ghost"

                      onClick={() => removeEvent(event.id)}

                    >

                      Remove

                    </button>

                  </li>

                ))}

              </ul>

            )}

          </section>



          <section className="calendar-panel">

            <h3 className="panel-title">Add event</h3>

            <EventForm

              anchorDate={selectedDate}

              draft={draft}

              onDraftChange={setDraft}

              onSubmit={addEvent}

            />

          </section>

        </div>

      </div>

    </div>

  );

}


