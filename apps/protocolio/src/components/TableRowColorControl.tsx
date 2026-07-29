import DeferredTextInput from './DeferredTextInput';
import { COLOR_PLACEHOLDER } from '../lib/units';

interface TableRowColorControlProps {
  id: string;
  label?: string;
  value: string | undefined;
  onCommit: (color: string | undefined) => void;
}

export default function TableRowColorControl({ id, label = 'Highlight', value, onCommit }: TableRowColorControlProps) {
  return (
    <>
      <label className="table-row-height-label" htmlFor={id}>{label}</label>
      <div className="table-row-color-field">
        <span
          className="table-row-color-swatch"
          style={{ background: value || 'transparent' }}
          aria-hidden="true"
        />
        <DeferredTextInput
          id={id}
          className="table-row-height-input table-row-color-input"
          placeholder={COLOR_PLACEHOLDER}
          value={value ?? ''}
          onCommit={raw => onCommit(raw.trim() || undefined)}
        />
        {value && (
          <button
            type="button"
            className="table-row-color-clear"
            title="Remove highlight"
            onClick={() => onCommit(undefined)}
          >
            ×
          </button>
        )}
      </div>
    </>
  );
}
