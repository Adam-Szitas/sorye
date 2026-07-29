import DeferredNumberInput from './DeferredNumberInput';
import { ptLabel } from '../lib/units';

interface TableRowHeightControlProps {
  id: string;
  label: string;
  value: number | undefined;
  onCommit: (height: number | undefined) => void;
}

export default function TableRowHeightControl({
  id,
  label,
  value,
  onCommit,
}: TableRowHeightControlProps) {
  return (
    <>
      <label className="table-row-height-label" htmlFor={id}>{label}</label>
      <DeferredNumberInput
        id={id}
        className="table-row-height-input"
        min={1}
        placeholder="auto"
        value={value}
        onCommit={onCommit}
      />
    </>
  );
}

export function tableRowHeightLabel(kind: 'header' | 'body'): string {
  return kind === 'header' ? ptLabel('Header H') : ptLabel('Body H');
}
