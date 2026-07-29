import { Select } from '@sorye/sdk/react';

interface TimePickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

function splitTime(value: string): [string, string] {
  const [h = '09', m = '00'] = value.split(':');
  const hour = HOURS.includes(h) ? h : '09';
  const minute = MINUTES.includes(m) ? m : '00';
  return [hour, minute];
}

export function TimePicker({ id, label, value, onChange }: TimePickerProps) {
  const [hour, minute] = splitTime(value);

  const update = (nextHour: string, nextMinute: string) => {
    onChange(`${nextHour}:${nextMinute}`);
  };

  return (
    <div className="time-picker" role="group" aria-labelledby={`${id}-label`}>
      <span className="time-picker-label" id={`${id}-label`}>
        {label}
      </span>
      <div className="time-picker-controls">
        <Select
          compact
          value={hour}
          options={HOURS.map((h) => ({ value: h, label: h }))}
          onSoryeChange={(e) => update(e.detail.value, minute)}
        />
        <span className="time-picker-sep" aria-hidden="true">
          :
        </span>
        <Select
          compact
          value={minute}
          options={MINUTES.map((m) => ({ value: m, label: m }))}
          onSoryeChange={(e) => update(hour, e.detail.value)}
        />
      </div>
    </div>
  );
}
