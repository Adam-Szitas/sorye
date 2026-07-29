import type { TableBlock, MergedTableBlock, BorderStyle, FontStyle } from '@protocolio/sdk';
import DeferredNumberInput from './DeferredNumberInput';
import { ptLabel, colorLabel, COLOR_PLACEHOLDER } from '../lib/units';

type TableLike = TableBlock | MergedTableBlock;

interface TableOptionsPanelProps<T extends TableLike> {
  table: T;
  onUpdate: (patch: Partial<T>) => void;
}

export default function TableOptionsPanel<T extends TableLike>({ table, onUpdate: commitUpdate }: TableOptionsPanelProps<T>) {
  // TableBlock and MergedTableBlock share every field this panel edits; the cast here
  // lets call sites below stay untyped-union without each needing its own assertion.
  function onUpdate(patch: Partial<TableLike>) {
    commitUpdate(patch as Partial<T>);
  }

  const showBorder = table.showBorder !== false;
  const showHeader = table.showHeader !== false;
  const borderH = table.borderHorizontal !== false;
  const borderV = table.borderVertical !== false;
  const cellPadding = typeof table.cellPadding === 'number'
    ? table.cellPadding
    : table.cellPadding?.top ?? table.cellPadding?.bottom;

  function updateBorder(patch: Partial<BorderStyle>) {
    onUpdate({ border: { ...table.border, ...patch } });
  }

  function updateOuterBorder(patch: Partial<BorderStyle>) {
    onUpdate({ outerBorder: { ...table.outerBorder, ...patch } });
  }

  function updateCellFont(patch: Partial<FontStyle>) {
    onUpdate({ cellFont: { ...table.cellFont, ...patch } });
  }

  function updateHeaderFont(patch: Partial<FontStyle>) {
    onUpdate({ headerFont: { ...table.headerFont, ...patch } });
  }

  return (
    <>
      <div className="row">
        <div className="checkbox-row table-border-toggle">
          <input
            type="checkbox"
            id={`${table.type}-show-header`}
            checked={showHeader}
            onChange={e => onUpdate({ showHeader: e.target.checked ? undefined : false })}
          />
          <label htmlFor={`${table.type}-show-header`}>Show header row</label>
        </div>
        <div>
          <label>{ptLabel('Cell padding')}</label>
          <DeferredNumberInput
            min={0}
            placeholder="auto"
            value={cellPadding}
            onCommit={v => onUpdate({ cellPadding: v === undefined ? undefined : v })}
          />
        </div>
      </div>

      <h3 className="table-options-subheading">Row heights</h3>
      <div className="row">
        {showHeader && (
          <div>
            <label>{ptLabel('Header row height')}</label>
            <DeferredNumberInput
              min={1}
              placeholder="auto"
              value={table.headerRowHeight}
              onCommit={headerRowHeight => onUpdate({
                headerRowHeight: headerRowHeight && headerRowHeight > 0 ? headerRowHeight : undefined,
              })}
            />
          </div>
        )}
        <div>
          <label>{ptLabel('Body row height')}</label>
          <DeferredNumberInput
            min={1}
            placeholder="auto"
            value={table.rowHeight}
            onCommit={rowHeight => onUpdate({ rowHeight: rowHeight && rowHeight > 0 ? rowHeight : undefined })}
          />
        </div>
      </div>
      <p className="section-hint" style={{ marginTop: 0, marginBottom: 8 }}>
        Default body row band size in pt (including padding). Override individual rows in the height field at the end of each row.
        Heights apply to the PDF; the editor preview scales rows to match.
      </p>

      <h3 className="table-options-subheading">Typography</h3>
      <div className="row">
        {showHeader && (
          <div>
            <label>{ptLabel('Header line height')}</label>
            <DeferredNumberInput
              min={0}
              placeholder="auto"
              value={table.headerFont?.lineHeight}
              onCommit={lineHeight => updateHeaderFont({
                lineHeight: lineHeight != null && lineHeight >= 0 ? lineHeight : undefined,
              })}
            />
          </div>
        )}
        <div>
          <label>{ptLabel('Body line height')}</label>
          <DeferredNumberInput
            min={0}
            placeholder="auto"
            value={table.cellFont?.lineHeight}
            onCommit={lineHeight => updateCellFont({
              lineHeight: lineHeight != null && lineHeight >= 0 ? lineHeight : undefined,
            })}
          />
        </div>
      </div>
      <p className="section-hint" style={{ marginTop: 0, marginBottom: 8 }}>
        Extra spacing between lines inside cells (pt). Leave empty to use the page default.
      </p>

      <div className="row">
        <div>
          <label>{ptLabel('Column gap')}</label>
          <DeferredNumberInput
            min={0}
            placeholder="0"
            value={table.columnGap}
            emptyValue={0}
            onCommit={columnGap => onUpdate({ columnGap })}
          />
        </div>
        <div>
          <label>{ptLabel('Row gap')}</label>
          <DeferredNumberInput
            min={0}
            placeholder="0"
            value={table.rowGap}
            emptyValue={0}
            onCommit={rowGap => onUpdate({ rowGap })}
          />
        </div>
        <div className="checkbox-row table-border-toggle">
          <input
            type="checkbox"
            id={`${table.type}-show-border`}
            checked={showBorder}
            onChange={e => onUpdate({ showBorder: e.target.checked })}
          />
          <label htmlFor={`${table.type}-show-border`}>Show borders in PDF</label>
        </div>
      </div>

      {!showBorder && (
        <p className="section-hint">PDF borders are off. The editor grid below always shows cell outlines for editing.</p>
      )}

      {showBorder && (
        <>
          <div className="row">
            <div className="checkbox-row">
              <input
                type="checkbox"
                id={`${table.type}-border-h`}
                checked={borderH}
                onChange={e => onUpdate({ borderHorizontal: e.target.checked ? undefined : false })}
              />
              <label htmlFor={`${table.type}-border-h`}>Horizontal lines</label>
            </div>
            <div className="checkbox-row">
              <input
                type="checkbox"
                id={`${table.type}-border-v`}
                checked={borderV}
                onChange={e => onUpdate({ borderVertical: e.target.checked ? undefined : false })}
              />
              <label htmlFor={`${table.type}-border-v`}>Vertical lines</label>
            </div>
          </div>
          <div className="row">
            <div>
              <label>{ptLabel('Inner border width')}</label>
              <DeferredNumberInput
                min={0}
                placeholder="0.5"
                value={table.border?.width}
                emptyValue={0.5}
                onCommit={width => updateBorder({ width, color: table.border?.color })}
              />
            </div>
            <div>
              <label>{colorLabel('Inner border color')}</label>
              <input
                type="text"
                placeholder={COLOR_PLACEHOLDER}
                value={table.border?.color ?? ''}
                onChange={e => updateBorder({ color: e.target.value || undefined, width: table.border?.width })}
              />
            </div>
          </div>
          <div className="row">
            <div>
              <label>{ptLabel('Outer border width')}</label>
              <DeferredNumberInput
                min={0}
                placeholder="none"
                value={table.outerBorder?.width}
                onCommit={width => updateOuterBorder({
                  width,
                  color: table.outerBorder?.color ?? table.border?.color,
                })}
              />
            </div>
            <div>
              <label>{colorLabel('Outer border color')}</label>
              <input
                type="text"
                placeholder={COLOR_PLACEHOLDER}
                value={table.outerBorder?.color ?? ''}
                onChange={e => updateOuterBorder({
                  color: e.target.value || undefined,
                  width: table.outerBorder?.width,
                })}
              />
            </div>
          </div>
          <p className="section-hint" style={{ marginTop: 0 }}>
            Set an outer border width to emphasize the table frame. Turn off horizontal or vertical lines for open grids.
          </p>
        </>
      )}

      <p className="section-hint table-layout-hint">
        Cell text supports line breaks (Shift+Enter) and <code>**bold**</code> markers.
        {!showHeader && ' With the header row off, edit column labels under Column settings below.'}
      </p>
    </>
  );
}
