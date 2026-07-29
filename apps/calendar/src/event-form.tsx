import { useMemo, useState } from 'react';
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

const SCHEDULE_OPTIONS: Array<{ kind: EventKind; label: string; hint: string }> =
  [
    { kind: 'timed', label: 'Time range', hint: 'One day with start and end' },
    { kind: 'allDay', label: 'All day', hint: 'Blocks the full day' },
    {
      kind: 'multiDate',
      label: 'Multiple days',
      hint: 'Select days on the calendar',
    },
  ];

function formatChipDate(dateKey: string): string {
  return parseDateKey(dateKey).toLocaleDateString(undefined, {
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
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedDatesLabel = useMemo(() => {
    if (draft.dates.length === 0) return 'No dates selected';
    if (draft.dates.length === 1) {
      return parseDateKey(draft.dates[0]).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    }
    return `${draft.dates.length} days selected`;
  }, [draft.dates]);

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
      setError('Add a title for the event.');
      return;
    }
    if (draft.dates.length === 0) {
      setError('Select at least one date.');
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
        Title
        <input
          type="text"
          placeholder="Team standup"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <fieldset className="schedule-type-fieldset">
        <legend>Schedule</legend>
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
              <strong>{option.label}</strong>
              <span>{option.hint}</span>
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
            Click days on the calendar to add or remove them.
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
            <span>Same time range on each day</span>
          </label>
        </div>
      )}

      {draft.kind === 'timed' ||
      (draft.kind === 'multiDate' && draft.multiTimed) ? (
        <div className="time-range-row">
          <TimePicker
            id="event-start"
            label="From"
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
            label="To"
            value={draft.endTime}
            onChange={(endTime) => onDraftChange({ ...draft, endTime })}
          />
        </div>
      ) : (
        <p className="schedule-all-day-note">This event spans the entire day.</p>
      )}

      {error ? <p className="form-error">{error}</p> : null}

      <button type="button" className="btn-primary" onClick={submit}>
        Add to calendar
      </button>
    </div>
  );
}
