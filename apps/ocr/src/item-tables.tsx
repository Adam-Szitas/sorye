import type { OcrDocumentItem } from '@sorye/types';

function padRow(row: string[], cols: number): string[] {
  return Array.from({ length: cols }, (_, i) => row[i]?.trim() ?? '');
}

function cellText(value: string): string {
  return value.trim() || '—';
}

interface ItemTableProps {
  item: OcrDocumentItem;
  index: number;
  className?: string;
}

export function ItemTable({ item, index, className }: ItemTableProps) {
  const cols = Math.max(
    item.header.length,
    item.note.length,
    item.amounts.length,
  );
  const header = padRow(item.header, cols);
  const note = padRow(item.note, cols);
  const amounts = padRow(item.amounts, cols);
  const tableClass = className ?? 'ocr-item-table';

  return (
    <section className="ocr-item-block" aria-label={`Item ${index + 1}`}>
      <h4 className="ocr-item-title">Item {index + 1}</h4>
      <table className={tableClass}>
        <thead>
          <tr>
            {header.map((cell, c) => (
              <th key={`h-${c}`}>{cellText(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="ocr-item-row-note">
            {note.map((cell, c) => (
              <td key={`n-${c}`}>{cellText(cell)}</td>
            ))}
          </tr>
          <tr className="ocr-item-row-amounts">
            {amounts.map((cell, c) => (
              <td key={`a-${c}`}>{cellText(cell)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}

interface DocumentItemsPreviewProps {
  items: OcrDocumentItem[];
  className?: string;
}

export function DocumentItemsPreview({
  items,
  className,
}: DocumentItemsPreviewProps) {
  if (items.length === 0) {
    return <p className="ocr-muted">No items could be reconstructed.</p>;
  }

  return (
    <div className="ocr-items-stack">
      {items.map((item, i) => (
        <ItemTable
          key={`item-${i}`}
          item={item}
          index={i}
          className={className}
        />
      ))}
    </div>
  );
}
