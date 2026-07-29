import { useEffect, useState, type InputHTMLAttributes } from 'react';

export interface DeferredTextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'> {
  value: string;
  onCommit: (value: string) => void;
}

/** Text input that commits on blur/Enter instead of every keystroke (avoids stale parent state). */
export default function DeferredTextInput({
  value,
  onCommit,
  ...rest
}: DeferredTextInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(null);
  }, [value, focused]);

  const displayValue = draft !== null ? draft : value;

  function commit(raw: string) {
    onCommit(raw);
  }

  return (
    <input
      {...rest}
      type="text"
      value={displayValue}
      onFocus={() => {
        setFocused(true);
        setDraft(value);
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
    />
  );
}
