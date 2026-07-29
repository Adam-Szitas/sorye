import type { Block, TableBlock, TableColumn } from '@protocolio/sdk';

import { normalizeTableBlock } from '../lib/tableUtils';

import DeferredTextInput from './DeferredTextInput';

import DeferredTextarea from './DeferredTextarea';

import TableOptionsPanel from './TableOptionsPanel';

import { ptOrPercentLabel } from '../lib/units';
import { columnBorderClass } from '../lib/tableColumnUi';
import { updateRowHeightAt, removeRowHeightAt, resolveEditorRowMinHeight, rowHeightStyle } from '../lib/tableRowHeight';
import TableRowHeightControl, { tableRowHeightLabel } from './TableRowHeightControl';
import { updateRowBackgroundAt, removeRowBackgroundAt, resolveRowBackground } from '../lib/tableRowBackground';
import TableRowColorControl from './TableRowColorControl';



interface TableConfigProps {

  block: TableBlock;

  onChange: (block: Block) => void;

}



function parseColumnWidth(raw: string): string | number | undefined {

  const trimmed = raw.trim();

  if (!trimmed) return undefined;

  if (trimmed.endsWith('%')) return trimmed;

  const n = Number(trimmed);

  return Number.isFinite(n) ? n : trimmed;

}



export default function TableConfig({ block, onChange }: TableConfigProps) {

  const table = normalizeTableBlock(block);

  const showHeader = table.showHeader !== false;

  const colCount = Math.max(1, table.columns.length);



  function commit(next: TableBlock) {

    onChange(normalizeTableBlock(next));

  }



  function update(patch: Partial<TableBlock>) {

    commit({ ...table, ...patch });

  }



  function updateColumn(ci: number, patch: Partial<TableColumn>) {

    const columns = [...table.columns];

    columns[ci] = { ...columns[ci]!, ...patch };

    commit({ ...table, columns });

  }



  function updateCell(ri: number, ci: number, value: string) {

    const rows = table.rows.map(r => [...r]);

    rows[ri]![ci] = value;

    commit({ ...table, rows });

  }



  function addColumn() {

    const columns = [...table.columns, { header: `Column ${table.columns.length + 1}`, align: 'left' as const }];

    const rows = table.rows.map(r => [...r, '']);

    commit({ ...table, columns, rows });

  }



  function removeColumn(ci: number) {

    if (table.columns.length <= 1) return;

    const columns = table.columns.filter((_, i) => i !== ci);

    const rows = table.rows.map(r => r.filter((_, i) => i !== ci));

    commit({ ...table, columns, rows });

  }



  function addRow() {

    const rows = [...table.rows, table.columns.map(() => '' as string)];

    commit({ ...table, rows });

  }



  function removeRow(ri: number) {
    commit({
      ...removeRowBackgroundAt(removeRowHeightAt(table, ri), ri),
      rows: table.rows.filter((_, i) => i !== ri),
    });
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

  return (

    <div className="table-config">

      <TableOptionsPanel table={table} onUpdate={update} />



      <div className="table-spreadsheet" style={{ '--table-cols': colCount } as React.CSSProperties}>
        {showHeader && (
        <div className="table-spreadsheet-row table-spreadsheet-header-row">
          {table.columns.map((col, ci) => (
            <div
              key={ci}
              className={columnBorderClass(col, 'table-spreadsheet-cell')}
              style={table.headerBackground ? { background: table.headerBackground } : undefined}
            >
              <DeferredTextInput
                className="table-spreadsheet-input"
                aria-label={`Column ${ci + 1} header`}
                placeholder={`Header ${ci + 1}`}
                value={col.header}
                onCommit={header => updateColumn(ci, { header })}
              />
            </div>
          ))}
          <div className="table-spreadsheet-actions table-spreadsheet-actions-head">
            <TableRowColorControl
              id="table-header-bg"
              label="Header"
              value={table.headerBackground}
              onCommit={updateHeaderBackground}
            />
          </div>
        </div>
        )}

        {table.rows.length === 0 ? (

          <div className="table-spreadsheet-empty">

            No data rows yet. Click &quot;+ Data row&quot; below.

          </div>

        ) : (

          table.rows.map((row, ri) => {
            const rowBg = resolveRowBackground(table, ri);
            return (

            <div key={ri} className="table-spreadsheet-row" style={rowHeightStyle(resolveEditorRowMinHeight(table, ri))}>

              {row.map((cell, ci) => (

                <div
                  key={ci}
                  className={columnBorderClass(table.columns[ci], 'table-spreadsheet-cell')}
                  style={rowBg ? { background: rowBg } : undefined}
                >

                  <DeferredTextarea

                    className="table-spreadsheet-input table-spreadsheet-textarea"

                    aria-label={`Row ${ri + 1}, ${table.columns[ci]?.header || `column ${ci + 1}`}`}

                    placeholder="Value"

                    rows={1}

                    value={typeof cell === 'object' ? cell.text : String(cell ?? '')}

                    onCommit={value => updateCell(ri, ci, value)}

                  />

                </div>

              ))}

              <div className="table-spreadsheet-actions">
                <TableRowHeightControl
                  id={`table-row-h-${ri}`}
                  label={tableRowHeightLabel('body')}
                  value={table.rowHeights?.[ri] ?? table.rowHeight}
                  onCommit={height => updateRowHeight(ri, height)}
                />
                <TableRowColorControl
                  id={`table-row-bg-${ri}`}
                  value={rowBg}
                  onCommit={color => updateRowBackground(ri, color)}
                />
                <button
                  type="button"
                  className="table-remove-row"
                  onClick={() => removeRow(ri)}
                  title="Remove row"
                >
                  Remove
                </button>
              </div>

            </div>

            );
          })

        )}

      </div>



      <div className="row table-content-actions">

        <button type="button" onClick={addRow}>+ Data row</button>

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

              <label className="table-editor-field-label" htmlFor={`table-header-label-${ci}`}>Header label</label>
              <DeferredTextInput
                id={`table-header-label-${ci}`}
                className="table-editor-input"
                placeholder={`Column ${ci + 1}`}
                value={col.header}
                onCommit={header => updateColumn(ci, { header })}
              />

              <label className="table-editor-field-label" htmlFor={`table-width-${ci}`}>Width</label>

              <DeferredTextInput

                id={`table-width-${ci}`}

                className="table-editor-input"

                placeholder="auto"

                value={col.width === undefined ? '' : String(col.width)}

                onCommit={raw => updateColumn(ci, { width: parseColumnWidth(raw) })}

              />

              <label className="table-editor-field-label" htmlFor={`table-align-${ci}`}>Align</label>

              <select

                id={`table-align-${ci}`}

                className="table-editor-input"

                value={col.align ?? 'left'}

                onChange={e => updateColumn(ci, { align: e.target.value as TableColumn['align'] })}

              >

                <option value="left">Left</option>

                <option value="center">Center</option>

                <option value="right">Right</option>

              </select>

              <label className="table-editor-field-label" htmlFor={`table-hborder-${ci}`}>Horizontal lines</label>

              <select

                id={`table-hborder-${ci}`}

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

