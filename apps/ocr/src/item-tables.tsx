import type {
  OcrLayoutCell,
  OcrLayoutRow,
  OcrPageLayout,
  OcrTextStyle,
} from '@sorye/types';

function cellText(value: string): string {
  return value.trim() || '\u00a0';
}

function sizeScale(rank: OcrTextStyle['sizeRank']): number {
  switch (rank) {
    case 'xl':
      return 1.35;
    case 'lg':
      return 1.15;
    case 'sm':
      return 0.9;
    default:
      return 1;
  }
}

function cellClassName(cell: OcrLayoutCell, role: OcrLayoutRow['role']): string {
  const parts = ['ocr-layout-cell'];
  if (!cell.text.trim()) parts.push('ocr-segment-empty');
  if (cell.style.bold) parts.push('ocr-cell-bold');
  if (cell.style.italic) parts.push('ocr-cell-italic');
  parts.push(`ocr-cell-size-${cell.style.sizeRank}`);
  parts.push(`ocr-row-role-${role}`);
  return parts.join(' ');
}

function LayoutRowView({
  row,
  rowIndex,
  baseFontPx,
}: {
  row: OcrLayoutRow;
  rowIndex: number;
  baseFontPx: number;
}) {
  return (
    <tr className={`ocr-layout-row ocr-layout-row-${row.role}`}>
      {row.cells.map((cell, c) => {
        const Tag = row.role === 'title' || row.role === 'header' ? 'th' : 'td';
        const scale = sizeScale(cell.style.sizeRank);
        return (
          <Tag
            key={`r${rowIndex}-c${c}`}
            className={cellClassName(cell, row.role)}
            style={{
              textAlign: cell.align,
              fontSize: `${Math.max(11, baseFontPx * scale)}px`,
              fontWeight: cell.style.bold
                ? 700
                : row.role === 'header'
                  ? 650
                  : 400,
              fontStyle: cell.style.italic ? 'italic' : undefined,
            }}
            title={[
              cell.style.fontName ? `font: ${cell.style.fontName}` : null,
              `size: ${Math.round(cell.style.fontSize)}px (${cell.style.sizeRank})`,
              cell.style.bold ? 'bold' : null,
              cell.style.italic ? 'italic' : null,
              cell.confidence > 0
                ? `confidence: ${Math.round(cell.confidence)}%`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            {cellText(cell.text)}
          </Tag>
        );
      })}
    </tr>
  );
}

interface LayoutMatrixPreviewProps {
  layout: OcrPageLayout;
  className?: string;
  pageLabel?: string;
}

export function LayoutMatrixPreview({
  layout,
  className,
  pageLabel,
}: LayoutMatrixPreviewProps) {
  if (!layout.rows.length) {
    return <p className="ocr-muted">No layout could be reconstructed.</p>;
  }

  const tableClass = className ?? 'ocr-layout-table';
  const baseFontPx = 13;

  return (
    <section className="ocr-layout-block" aria-label={pageLabel ?? 'Layout matrix'}>
      {pageLabel ? <h4 className="ocr-item-title">{pageLabel}</h4> : null}
      <div className="ocr-item-table-shell">
        <table className={tableClass}>
          <colgroup>
            {layout.columnWidths.map((width, i) => (
              <col key={`col-${i}`} style={{ width: `${width}%` }} />
            ))}
          </colgroup>
          <tbody>
            {layout.rows.map((row, r) => (
              <LayoutRowView
                key={`row-${r}`}
                row={row}
                rowIndex={r}
                baseFontPx={baseFontPx}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="ocr-layout-legend">
        {layout.rows.length} row{layout.rows.length === 1 ? '' : 's'} ·{' '}
        {layout.cols} col{layout.cols === 1 ? '' : 's'}
        {' · '}
        median {Math.round(layout.medianFontSize)}px
        {layout.rows.some((r) => r.role === 'title') ? ' · title rows' : ''}
        {layout.rows.some((r) => r.role === 'header') ? ' · header rows' : ''}
      </p>
    </section>
  );
}

export interface OcrPageLayoutView {
  page: number;
  layout: OcrPageLayout;
}

interface DocumentPagesPreviewProps {
  pages: OcrPageLayoutView[];
  className?: string;
}

export function DocumentPagesPreview({
  pages,
  className,
}: DocumentPagesPreviewProps) {
  const nonEmpty = pages.filter((p) =>
    p.layout.rows.some((row) => row.cells.some((c) => c.text.trim())),
  );
  if (nonEmpty.length === 0) {
    return <p className="ocr-muted">No layout could be reconstructed.</p>;
  }

  return (
    <div className="ocr-pages-stack">
      {nonEmpty.map((page) => (
        <LayoutMatrixPreview
          key={`page-${page.page}`}
          layout={page.layout}
          className={className}
          pageLabel={
            nonEmpty.length > 1 ? `Page ${page.page}` : undefined
          }
        />
      ))}
    </div>
  );
}

/** @deprecated Prefer LayoutMatrixPreview / DocumentPagesPreview. */
export {
  LayoutMatrixPreview as DocumentItemsPreview,
};
