import { useEffect, useState, type TextareaHTMLAttributes } from 'react';

export interface DeferredTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onBlur'> {
  value: string;
  onCommit: (value: string) => void;
}

/** Multiline input: Shift+Enter for newline, Enter or blur to commit. */
export default function DeferredTextarea({
  value,
  onCommit,
  rows = 2,
  ...rest
}: DeferredTextareaProps) {
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
    <textarea
      {...rest}
      rows={rows}
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
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}
