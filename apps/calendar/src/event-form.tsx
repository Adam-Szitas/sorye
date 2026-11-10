import { useMemo, useState } from 'react';
import { getLocale, translate, type MessageKey, type MessageParams } from '@sorye/platform';
import { useI18n } from '@sorye/platform/react';
import {
  defaultEndTime,
  type CalendarEvent,
  type EventKind,
  validateTimedRange,
} from './event-schedule';
import { parseDateKey } from './calendar-storage';
import { TimePicker } from './time-picker';

export type ScheduleDraft = {
  kind: EventKind;
  dates: string[];
  startTime: string;
  endTime: string;
  multiTimed: boolean;
};

interface EventFormProps {
  anchorDate: string;
  draft: ScheduleDraft;
  onDraftChange: (draft: ScheduleDraft) => void;
  onSubmit: (event: Omit<CalendarEvent, 'id'>) => void;
}

const tr = (key: MessageKey, params?: MessageParams) => translate(getLocale(), key, params);

const SCHEDULE_OPTIONS: Array<{ kind: EventKind; label: MessageKey; hint: MessageKey }> =
  [
    { kind: 'timed', label: 'calendar.optTimed', hint: 'calendar.optTimedHint' },
    { kind: 'allDay', label: 'calendar.allDay', hint: 'calendar.optAllDayHint' },
    { kind: 'multiDate', label: 'calendar.optMulti', hint: 'calendar.optMultiHint' },
  ];

function formatChipDate(dateKey: string): string {
  return parseDateKey(dateKey).toLocaleDateString(getLocale(), {
    month: 'short',
    day: 'numeric',
  });
}

export function buildInitialDraft(anchorDate: string): ScheduleDraft {
  const startTime = '10:00';
  return {
    kind: 'timed',
    dates: [anchorDate],
    startTime,
    endTime: defaultEndTime(startTime),
    multiTimed: false,
  };
}

export function EventForm({
  anchorDate,
  draft,
  onDraftChange,
  onSubmit,
}: EventFormProps) {
  const { t, locale } = useI18n();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedDatesLabel = useMemo(() => {
    if (draft.dates.length === 0) return t('calendar.noDates');
    if (draft.dates.length === 1) {
      return parseDateKey(draft.dates[0]).toLocaleDateString(locale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    }
    return t('calendar.nDatesSelected', { n: draft.dates.length });
  }, [draft.dates, locale]);

  const setKind = (kind: EventKind) => {
    setError(null);
    if (kind === 'multiDate') {
      onDraftChange({
        ...draft,
        kind,
        dates: draft.dates.length > 0 ? draft.dates : [anchorDate],
      });
      return;
    }
    onDraftChange({
      ...draft,
      kind,
      dates: [draft.dates[0] ?? anchorDate],
      multiTimed: kind === 'timed' ? draft.multiTimed : false,
    });
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError(t('calendar.errTitle'));
      return;
    }
    if (draft.dates.length === 0) {
      setError(t('calendar.errDate'));
      return;
    }

    if (draft.kind === 'timed') {
      const rangeError = validateTimedRange(draft.startTime, draft.endTime);
      if (rangeError) {
        setError(rangeError);
        return;
      }
      onSubmit({
        title: trimmed,
        kind: 'timed',
        dates: [draft.dates[0]],
        startTime: draft.startTime,
        endTime: draft.endTime,
      });
    } else if (draft.kind === 'allDay') {
      onSubmit({
        title: trimmed,
        kind: 'allDay',
        dates: [draft.dates[0]],
      });
    } else {
      const sortedDates = [...new Set(draft.dates)].sort();
      if (draft.multiTimed) {
        const rangeError = validateTimedRange(draft.startTime, draft.endTime);
        if (rangeError) {
          setError(rangeError);
          return;
        }
        onSubmit({
          title: trimmed,
          kind: 'multiDate',
          dates: sortedDates,
          startTime: draft.startTime,
          endTime: draft.endTime,
        });
      } else {
        onSubmit({
          title: trimmed,
          kind: 'multiDate',
          dates: sortedDates,
        });
      }
    }

    setTitle('');
    setError(null);
  };

  return (
    <div className="calendar-form">
      <label className="field">
        {t('calendar.title')}
        <input
          type="text"
          placeholder={t('calendar.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <fieldset className="schedule-type-fieldset">
        <legend>{t('calendar.schedule')}</legend>
        <div className="schedule-type-options" role="radiogroup">
          {SCHEDULE_OPTIONS.map((option) => (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={draft.kind === option.kind ? 'true' : 'false'}
              className={[
                'schedule-type-option',
                draft.kind === option.kind && 'active',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setKind(option.kind)}
            >
              <strong>{t(option.label)}</strong>
              <span>{t(option.hint)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {draft.kind !== 'multiDate' ? (
        <p className="schedule-date-summary">{selectedDatesLabel}</p>
      ) : (
        <div className="multi-date-summary">
          <p className="schedule-date-summary">{selectedDatesLabel}</p>
          <p className="schedule-hint">
            {t('calendar.multiClickHint')}
          </p>
          {draft.dates.length > 0 ? (
            <ul className="date-chip-list">
              {[...draft.dates].sort().map((dateKey) => (
                <li key={dateKey}>
                  <span className="date-chip">{formatChipDate(dateKey)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="toggle-field">
            <input
              type="checkbox"
              checked={draft.multiTimed}
              onChange={(e) =>
                onDraftChange({ ...draft, multiTimed: e.target.checked })
              }
            />
            <span>{t('calendar.sameTime')}</span>
          </label>
        </div>
      )}

      {draft.kind === 'timed' ||
      (draft.kind === 'multiDate' && draft.multiTimed) ? (
        <div className="time-range-row">
          <TimePicker
            id="event-start"
            label={t('calendar.from')}
            value={draft.startTime}
            onChange={(startTime) =>
              onDraftChange({
                ...draft,
                startTime,
                endTime:
                  validateTimedRange(startTime, draft.endTime) === null
                    ? draft.endTime
                    : defaultEndTime(startTime),
              })
            }
          />
          <TimePicker
            id="event-end"
            label={t('calendar.to')}
            value={draft.endTime}
            onChange={(endTime) => onDraftChange({ ...draft, endTime })}
          />
        </div>
      ) : (
        <p className="schedule-all-day-note">{t('calendar.allDayNote')}</p>
      )}

      {error ? <p className="form-error">{error}</p> : null}

      <button type="button" className="btn-primary" onClick={submit}>
        {t('calendar.addToCalendar')}
      </button>
    </div>
  );
}
