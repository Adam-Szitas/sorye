import type { Block, MergedTableBlock, TableColumn, TableCellValue } from '@protocolio/sdk';
import {
  normalizeMergedTableBlock,
  updateCell,
  mergeCellDown,
  splitCell,
  addBodyRow,
  removeBodyRow,
  getCellRowspan,
  cellToString,
} from '../lib/mergedTableUtils';
import DeferredTextInput from './DeferredTextInput';
import DeferredTextarea from './DeferredTextarea';
import TableOptionsPanel from './TableOptionsPanel';
import { ptOrPercentLabel } from '../lib/units';
import { columnBorderClass } from '../lib/tableColumnUi';
import { updateRowHeightAt, resolveEditorRowMinHeight, rowHeightStyle } from '../lib/tableRowHeight';
import TableRowHeightControl, { tableRowHeightLabel } from './TableRowHeightControl';
import { updateRowBackgroundAt, resolveRowBackground } from '../lib/tableRowBackground';
import TableRowColorControl from './TableRowColorControl';

interface MergedTableConfigProps {
  block: MergedTableBlock;
  onChange: (block: Block) => void;
}

function parseColumnWidth(raw: string): string | number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.endsWith('%')) return trimmed;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : trimmed;
}

export default function MergedTableConfig({ block, onChange }: MergedTableConfigProps) {
  const table = normalizeMergedTableBlock(block);
  const showHeader = table.showHeader !== false;

  function commit(next: MergedTableBlock) {
    onChange(normalizeMergedTableBlock(next));
  }

  function update(patch: Partial<MergedTableBlock>) {
    commit({ ...table, ...patch });
  }

  function updateColumn(ci: number, patch: Partial<TableColumn>) {
    const columns = [...table.columns];
    columns[ci] = { ...columns[ci]!, ...patch };
    commit({ ...table, columns });
  }

  function addColumn() {
    const columns = [...table.columns, { header: `Column ${table.columns.length + 1}`, align: 'left' as const }];
    const rows = table.rows.map(r => [...r, '']);
    commit({ ...table, columns, rows });
  }

  function updateRowHeight(ri: number, height: number | undefined) {
    commit(updateRowHeightAt(table, ri, height));
  }

  function updateRowBackground(ri: number, color: string | undefined) {
    commit(updateRowBackgroundAt(table, ri, color));
  }

  function updateHeaderBackground(color: string | undefined) {
    update({ headerBackground: color });
  }

  function removeColumn(ci: number) {
    if (table.columns.length <= 1) return;
    commit({
      ...table,
      columns: table.columns.filter((_, i) => i !== ci),
      rows: table.rows.map(r => r.filter((_, i) => i !== ci)),
    });
  }

  return (
    <div className="table-config merged-table-config">
      <TableOptionsPanel table={table} onUpdate={update} />

      <p className="section-hint">
        Use <strong>Merge down</strong> on a cell to stretch it across multiple rows (e.g. one label cell beside several values).
        Covered slots show as empty in the editor and are skipped in the PDF grid.
      </p>

      <div className="merged-table-editor-wrap">
        <table className="merged-table-editor">
          {showHeader && (
          <thead>
            <tr>
              {table.columns.map((col, ci) => (
                <th
                  key={ci}
                  className={columnBorderClass(col)}
                  style={table.headerBackground ? { background: table.headerBackground } : undefined}
                >
                  <DeferredTextInput
                    className="table-spreadsheet-input"
                    aria-label={`Column ${ci + 1} header`}
                    placeholder={`Header ${ci + 1}`}
                    value={col.header}
                    onCommit={header => updateColumn(ci, { header })}
                  />
                </th>
              ))}
              <th className="merged-table-row-actions-head">
                <TableRowColorControl
                  id="merged-header-bg"
                  label="Header"
                  value={table.headerBackground}
                  onCommit={updateHeaderBackground}
                />
              </th>
            </tr>
          </thead>
          )}
          <tbody>
            {table.rows.length === 0 ? (
              <tr>
                <td colSpan={table.columns.length + 1} className="merged-table-empty">
                  No data rows yet. Click &quot;+ Data row&quot; below.
                </td>
              </tr>
            ) : (
              table.rows.map((row, ri) => {
                const rowBg = resolveRowBackground(table, ri);
                return (
                <tr key={ri} style={rowHeightStyle(resolveEditorRowMinHeight(table, ri))}>
                  {row.map((cell, ci) => {
                    if (cell === null) return null;
                    const rowspan = getCellRowspan(table, ri, ci);
                    return (
                      <td
                        key={ci}
                        rowSpan={rowspan > 1 ? rowspan : undefined}
                        className={columnBorderClass(
                          table.columns[ci],
                          rowspan > 1 ? 'merged-table-cell-rowspan' : undefined,
                        ) || undefined}
                        style={rowBg ? { background: rowBg } : undefined}
                      >
                        <div className={rowspan > 1 ? 'merged-table-cell-inner' : undefined}>
                          <DeferredTextarea
                            className="table-spreadsheet-input table-spreadsheet-textarea"
                            aria-label={`Row ${ri + 1}, ${table.columns[ci]?.header || `column ${ci + 1}`}`}
                            placeholder="Value"
                            rows={rowspan > 1 ? 2 : 1}
                            value={cellToString(cell as TableCellValue)}
                            onCommit={value => commit(updateCell(table, ri, ci, value))}
                          />
                          <div className="merged-table-cell-actions">
                            <button
                              type="button"
                              title="Merge with row below"
                              onClick={() => commit(mergeCellDown(table, ri, ci))}
                            >
                              Merge down
                            </button>
                            {rowspan > 1 && (
                              <button
                                type="button"
                                title="Split merged cell"
                                onClick={() => commit(splitCell(table, ri, ci))}
                              >
                                Split
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                  <td className="merged-table-row-actions">
                    <TableRowHeightControl
                      id={`merged-row-h-${ri}`}
                      label={tableRowHeightLabel('body')}
                      value={table.rowHeights?.[ri] ?? table.rowHeight}
                      onCommit={height => updateRowHeight(ri, height)}
                    />
                    <TableRowColorControl
                      id={`merged-row-bg-${ri}`}
                      value={rowBg}
                      onCommit={color => updateRowBackground(ri, color)}
                    />
                    <button
                      type="button"
                      className="table-remove-row"
                      onClick={() => commit(removeBodyRow(table, ri))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="row table-content-actions">
        <button type="button" onClick={() => commit(addBodyRow(table))}>+ Data row</button>
        <button type="button" onClick={addColumn}>+ Column</button>
      </div>

      <details className="table-column-settings" open={!showHeader}>
        <summary>Column width, alignment &amp; borders</summary>
        <p className="section-hint">
          Width uses {ptOrPercentLabel('values')} (e.g. 40% or 80). Leave empty for equal columns.
          Turn off horizontal lines per column to get an open grid in that column only.
        </p>
        <div className="table-column-options">
          {table.columns.map((col, ci) => (
            <div key={ci} className="table-column-option">
              <label className="table-editor-field-label" htmlFor={`merged-header-label-${ci}`}>Header label</label>
              <DeferredTextInput
                id={`merged-header-label-${ci}`}
                className="table-editor-input"
                placeholder={`Column ${ci + 1}`}
                value={col.header}
                onCommit={header => updateColumn(ci, { header })}
              />
              <label className="table-editor-field-label" htmlFor={`merged-width-${ci}`}>Width</label>
              <DeferredTextInput
                id={`merged-width-${ci}`}
                className="table-editor-input"
                placeholder="auto"
                value={col.width === undefined ? '' : String(col.width)}
                onCommit={raw => updateColumn(ci, { width: parseColumnWidth(raw) })}
              />
              <label className="table-editor-field-label" htmlFor={`merged-align-${ci}`}>Align</label>
              <select
                id={`merged-align-${ci}`}
                className="table-editor-input"
                value={col.align ?? 'left'}
                onChange={e => updateColumn(ci, { align: e.target.value as TableColumn['align'] })}
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
              <label className="table-editor-field-label" htmlFor={`merged-hborder-${ci}`}>Horizontal lines</label>
              <select
                id={`merged-hborder-${ci}`}
                className="table-editor-input"
                value={col.borderHorizontal === false ? 'off' : 'on'}
                onChange={e => updateColumn(ci, {
                  borderHorizontal: e.target.value === 'on' ? undefined : false,
                })}
              >
                <option value="on">Show in this column</option>
                <option value="off">Hide in this column</option>
              </select>
              <button
                type="button"
                className="table-remove-col"
                disabled={table.columns.length <= 1}
                onClick={() => removeColumn(ci)}
              >
                Remove column
              </button>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
