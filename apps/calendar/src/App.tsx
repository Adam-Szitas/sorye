import { getLocale, registerPendingActionFlusher, switchAuthorizedWorkspace, translate, type MessageKey, type MessageParams } from '@sorye/platform';
import { useI18n, UserLoadSections, withActiveWorkspaceItems } from '@sorye/platform/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UserLoadPartition, UserLoadWorkspace } from '@sorye/types';

import {
  addMonths,
  buildMonthGrid,
  createCalendarStorage,
  parseDateKey,
  toDateKey,
  weekdayLabels,
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

/** Translate outside render (error state set from async callbacks). */
const tr = (key: MessageKey, params?: MessageParams) => translate(getLocale(), key, params);

export default function App() {
  const { t, locale } = useI18n();
  const storage = useMemo(() => createCalendarStorage(), []);
  const { loadEvents, saveEvents } = storage;
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventLoad, setEventLoad] = useState<UserLoadPartition<CalendarEvent> | null>(null);
  const [calendarWorkspace, setCalendarWorkspace] = useState<UserLoadWorkspace | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictDraftAvailable, setConflictDraftAvailable] = useState(false);
  const [queueStatus, setQueueStatus] = useState({ pending: 0, failed: 0, conflicts: 0, rejected: 0 });
  const [draft, setDraft] = useState<ScheduleDraft>(() =>
    buildInitialDraft(todayKey()),
  );

  useEffect(() => {
    let cancelled = false;
    void loadEvents()
      .then((next) => {
        if (cancelled) return;
        setEvents(next);
        const saved = storage.readLoad();
        setEventLoad(saved.load);
        setCalendarWorkspace(saved.workspace);
        setLoadState('ready');
        void storage.queueState().then(setQueueStatus).catch(() => undefined);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState('error');
          void storage.queueState().then(setQueueStatus).catch(() => undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const flushBestEffort = async () => {
      await storage.resendPending().catch(() => undefined);
      const state = await storage.queueState().catch(() => ({ pending: 1, failed: 0, conflicts: 0, rejected: 0 }));
      return state.pending + state.failed + state.conflicts + state.rejected;
    };
    const unregister = registerPendingActionFlusher('calendar', flushBestEffort);
    const refreshPending = () => { void storage.queueState().then(setQueueStatus).catch(() => undefined); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushBestEffort(); else refreshPending(); };
    window.addEventListener('pagehide', flushBestEffort);
    window.addEventListener('sorye:logout-flush', flushBestEffort);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushBestEffort);
      window.removeEventListener('sorye:logout-flush', flushBestEffort);
      document.removeEventListener('visibilitychange', onVisibility);
      unregister();
    };
  }, [storage]);

  const monthLabel = viewDate.toLocaleDateString(locale, {
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
    void saveEvents(next).then(
      () => { setSaveError(null); setConflictDraftAvailable(false); return storage.queueState(); },
      (err: unknown) => {
        setSaveError(err instanceof Error ? err.message : tr('calendar.saveFailed'));
        setConflictDraftAvailable(Boolean(storage.readConflictDraft()));
        return storage.queueState();
      },
    ).then(setQueueStatus).catch(() => undefined);
  }, [storage]);

  const resendPending = async () => {
    try {
      await storage.resendPending();
      const latest = await loadEvents();
      setEvents(latest);
      setSaveError(null);
    }
    catch (error) { setSaveError(error instanceof Error ? error.message : tr('calendar.pendingUnconfirmed')); }
    setQueueStatus(await storage.queueState().catch(() => queueStatus));
  };

  const downloadConflictDraft = () => {
    const draft = storage.readConflictDraft();
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sorye-calendar-conflict-draft.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const discardDraftAndReload = async () => {
    try {
      await storage.discardConflictsAndRejected();
      const latest = await loadEvents();
      storage.clearConflictDraft();
      setEvents(latest);
      setConflictDraftAvailable(false);
      setSaveError(null);
      setQueueStatus(await storage.queueState());
    } catch {
      setSaveError(tr('calendar.reloadFailed'));
    }
  };

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
      {loadState === 'loading' ? (
        <p className="calendar-empty">{t('calendar.loading')}</p>
      ) : null}
      {loadState === 'error' ? (
        <p className="calendar-empty" role="alert">
          {t('calendar.loadFailed')}
        </p>
      ) : null}
      {saveError ? (
        <div className="calendar-empty" role="alert">
          {saveError}
          {conflictDraftAvailable ? <div className="calendar-month-toolbar">
            <button type="button" className="btn-ghost" onClick={downloadConflictDraft}>{t('calendar.downloadDraft')}</button>
            <button type="button" className="btn-ghost" onClick={() => void discardDraftAndReload()}>{t('calendar.discardDraft')}</button>
          </div> : null}
        </div>
      ) : null}
      {queueStatus.pending + queueStatus.failed + queueStatus.conflicts + queueStatus.rejected > 0 ? (
        <div className="calendar-empty" role="status">
          {queueStatus.pending + queueStatus.failed} calendar action(s) await Rodrigo; {queueStatus.conflicts} conflict(s); {queueStatus.rejected} rejected.
          {queueStatus.pending + queueStatus.failed > 0 ? <button type="button" className="btn-ghost" onClick={() => void resendPending()}>{t('calendar.resend')}</button> : null}
        </div>
      ) : null}

      {loadState === 'ready' ? (
        <div className="calendar-layout">
          <section className="calendar-panel">
            <div className="calendar-month-toolbar">
              <button
                type="button"
                className="btn-ghost"
                aria-label={t('calendar.prevMonth')}
                onClick={() => setViewDate((d) => addMonths(d, -1))}
              >
                ←
              </button>
              <h2>{monthLabel}</h2>
              <button
                type="button"
                className="btn-ghost"
                aria-label={t('calendar.nextMonth')}
                onClick={() => setViewDate((d) => addMonths(d, 1))}
              >
                →
              </button>
            </div>

            {multiPickActive ? (
              <p className="calendar-pick-hint">
                {t('calendar.multiHint')}
              </p>
            ) : null}

            <div className="calendar-weekdays">
              {weekdayLabels(locale).map((d) => (
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
                {parseDateKey(selectedDate).toLocaleDateString(locale, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </h2>

              {eventLoad && calendarWorkspace ? (
                <UserLoadSections
                  load={withActiveWorkspaceItems(eventLoad, calendarWorkspace.id, events)}
                  empty="No events in this workspace."
                  heading="h3"
                  renderItems={(items) => (
                    <ul className="calendar-events">
                      {items.map((item) => (
                        <li key={`${item.workspaceId}:${item.value.id}`}>
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => {
                              void (async () => {
                                if (item.workspaceId !== calendarWorkspace.id) {
                                  const switched = await switchAuthorizedWorkspace(item.workspaceId);
                                  if (!switched) {
                                    setSaveError(tr('calendar.openWorkspaceFailed'));
                                    return;
                                  }
                                  const next = await loadEvents();
                                  setEvents(next);
                                  const saved = storage.readLoad();
                                  setEventLoad(saved.load);
                                  setCalendarWorkspace(saved.workspace);
                                }
                                const date = item.value.dates[0];
                                if (date) setSelectedDate(date);
                              })();
                            }}
                          >
                            <strong>{item.value.title}</strong>
                            <span>{formatEventSchedule(item.value)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                />
              ) : null}
              {dayEvents.length === 0 ? (
                <p className="calendar-empty">{t('calendar.noEvents')}</p>
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
                        {t('calendar.remove')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="calendar-panel">
              <h3 className="panel-title">{t('calendar.addEvent')}</h3>
              <EventForm
                anchorDate={selectedDate}
                draft={draft}
                onDraftChange={setDraft}
                onSubmit={addEvent}
              />
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
