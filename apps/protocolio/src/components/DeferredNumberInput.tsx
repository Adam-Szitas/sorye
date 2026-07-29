import { useEffect, useState, type InputHTMLAttributes } from 'react';

export interface DeferredNumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'> {
  value: number | undefined;
  onCommit: (value: number | undefined) => void;
  /** Value applied when the field is left empty on blur */
  emptyValue?: number | undefined;
}

/** Blur the active element so deferred number inputs commit before actions like Generate. */
export function commitFocusedInputs(): Promise<void> {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return Promise.resolve();
  return new Promise(resolve => {
    el.addEventListener('blur', () => resolve(), { once: true });
    el.blur();
    // blur handlers run synchronously; resolve on next tick if blur did not fire
    queueMicrotask(() => resolve());
  });
}

export default function DeferredNumberInput({
  value,
  onCommit,
  emptyValue,
  min,
  max,
  ...rest
}: DeferredNumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  // Drop stale draft when parent value changes while this field is not being edited
  useEffect(() => {
    if (!focused) setDraft(null);
  }, [value, focused]);

  const displayValue = draft !== null
    ? draft
    : value !== undefined
      ? String(value)
      : '';

  function clamp(n: number): number {
    let v = n;
    if (typeof min === 'number') v = Math.max(min, v);
    if (typeof max === 'number') v = Math.min(max, v);
    return v;
  }

  function commit(raw: string) {
    if (raw === '' || raw === '-') {
      onCommit(emptyValue);
      return;
    }
    const n = Number(raw);
    if (Number.isNaN(n)) {
      onCommit(emptyValue);
      return;
    }
    onCommit(clamp(n));
  }

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      className={rest.className ? `${rest.className} deferred-number-input` : 'deferred-number-input'}
      value={displayValue}
      onFocus={() => {
        setFocused(true);
        setDraft(value !== undefined ? String(value) : '');
      }}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) commit(draft);
        setDraft(null);
        setFocused(false);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
      }}
      onWheel={e => {
        // Prevent scroll-wheel from silently changing values (common when clicking Generate).
        e.currentTarget.blur();
        e.preventDefault();
      }}
    />
  );
}
