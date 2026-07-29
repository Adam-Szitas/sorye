import { useRef, useState, useId } from 'react';
import type { GridBlock, GridCell, GridAlign, GridValign, GridRowSettings } from '@protocolio/sdk';
import { maxTextWidthInGridCell, clampTextWidth } from '@protocolio/sdk';
import { SAMPLE_IMAGES, fileToDataUri, urlToDataUri, isDataUri } from '../lib/sampleImages';
import {
  resizeGridCells,
  setCellContent,
  getCellContentKind,
  updateCellBlock,
  normalizeGridBlock,
} from '../lib/gridUtils';
import DeferredNumberInput from './DeferredNumberInput';
import FontFamilySelect from './FontFamilySelect';
import { ptLabel } from '../lib/units';

interface GridConfigProps {
  block: GridBlock;
  defaultRowGap?: number;
  contentWidth: number;
  onChange: (block: GridBlock) => void;
}

export default function GridConfig({ block, defaultRowGap = 12, contentWidth, onChange }: GridConfigProps) {
  function update(patch: Partial<GridBlock>) {
    onChange(normalizeGridBlock({ ...block, ...patch }));
  }

  function updateDimensions(rows: number, columns: number) {
    const safeRows = Math.max(1, Math.min(6, rows));
    const safeCols = Math.max(1, Math.min(6, columns));
    update({
      rows: safeRows,
      columns: safeCols,
      cells: resizeGridCells(block.cells, safeRows, safeCols),
    });
  }

  function updateCell(row: number, col: number, cell: GridCell) {
    const cells = block.cells.map((r, ri) =>
      r.map((c, ci) => (ri === row && ci === col ? cell : c))
    );
    onChange(normalizeGridBlock({ ...block, cells }));
  }

  function updateRowSettings(row: number, patch: Partial<GridRowSettings>) {
    const rowSettings = [...(block.rowSettings ?? [])];
    while (rowSettings.length < block.rows) rowSettings.push({});
    rowSettings[row] = { ...rowSettings[row], ...patch };
    onChange(normalizeGridBlock({ ...block, rowSettings }));
  }

  return (
    <div className="grid-config">
      <div className="row">
        <div>
          <label>Rows</label>
          <DeferredNumberInput
            min={1}
            max={6}
            value={block.rows}
            emptyValue={1}
            onCommit={rows => updateDimensions(rows ?? 1, block.columns)}
          />
        </div>
        <div>
          <label>Columns</label>
          <DeferredNumberInput
            min={1}
            max={6}
            value={block.columns}
            emptyValue={1}
            onCommit={columns => updateDimensions(block.rows, columns ?? 1)}
          />
        </div>
        <div>
          <label>{ptLabel('Column gap')}</label>
          <DeferredNumberInput
            min={0}
            placeholder="8"
            value={block.gap}
            emptyValue={8}
            onCommit={gap => update({ gap })}
          />
        </div>
        <div>
          <label>{ptLabel('Row gap')}</label>
          <DeferredNumberInput
            min={0}
            placeholder={String(defaultRowGap)}
            value={block.rowGap}
            emptyValue={undefined}
            onCommit={rowGap => update({ rowGap })}
          />
          <p className="section-hint" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
            Space between grid rows (needs at least 2 rows). Leave empty to use page default ({defaultRowGap}).
          </p>
        </div>
      </div>

      <div className="row">
        <div>
          <label>Default horizontal align</label>
          <select value={block.align ?? 'left'} onChange={e => update({ align: e.target.value as GridAlign })}>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
          <p className="section-hint" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
            {block.equalColumns
              ? 'Equal columns span the full row; images default to center in each cell.'
              : 'Columns shrink to image/content size; text fills the rest. Center/right also align the row on the page.'}
          </p>
        </div>
        <div>
          <label>Default vertical align</label>
          <select value={block.valign ?? 'top'} onChange={e => update({ valign: e.target.value as GridValign })}>
            <option value="top">Top</option>
            <option value="center">Center</option>
            <option value="bottom">Bottom</option>
          </select>
        </div>
      </div>

      <div className="checkbox-row" style={{ marginTop: 8 }}>
        <input
          id="grid-equal-columns"
          type="checkbox"
          checked={block.equalColumns ?? false}
          onChange={e => {
            const equalColumns = e.target.checked;
            update({
              equalColumns,
              ...(equalColumns && block.align === undefined ? { align: 'center' } : {}),
            });
          }}
        />
        <label htmlFor="grid-equal-columns">Equal columns (50/50)</label>
      </div>
      <p className="section-hint" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
        Original layout: each column gets the same width and images are centered in their half.
      </p>

      {block.rows > 0 && (
        <>
          <h4 style={{ margin: '12px 0 8px', fontSize: '0.85rem' }}>Row margins</h4>
          {Array.from({ length: block.rows }, (_, row) => {
            const settings = block.rowSettings?.[row];
            return (
              <div key={row} className="row" style={{ alignItems: 'flex-end', marginBottom: 8 }}>
                <div style={{ minWidth: 56 }}>
                  <strong style={{ fontSize: '0.8rem' }}>Row {row + 1}</strong>
                </div>
                <div>
                  <label>{ptLabel('Top margin')}</label>
                  <DeferredNumberInput
                    min={0}
                    placeholder="0"
                    value={settings?.marginTop}
                    emptyValue={undefined}
                    onCommit={marginTop => updateRowSettings(row, { marginTop })}
                  />
                </div>
                <div>
                  <label>{ptLabel('Bottom margin')}</label>
                  <DeferredNumberInput
                    min={0}
                    placeholder="0"
                    value={settings?.marginBottom}
                    emptyValue={undefined}
                    onCommit={marginBottom => updateRowSettings(row, { marginBottom })}
                  />
                </div>
              </div>
            );
          })}
        </>
      )}

      <div
        className="grid-preview"
        style={{
          gridTemplateColumns: block.equalColumns
            ? `repeat(${block.columns}, minmax(0, 1fr))`
            : block.columns === 2
              ? 'auto minmax(0, 1fr)'
              : `repeat(${block.columns}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: block.rows }, (_, row) =>
          Array.from({ length: block.columns }, (_, col) => {
            const cell = block.cells[row]?.[col] ?? { blocks: [] };
            return (
              <GridCellEditor
                key={`${row}-${col}`}
                label={`Row ${row + 1}, Col ${col + 1}`}
                cell={cell}
                gridBlock={block}
                row={row}
                col={col}
                contentWidth={contentWidth}
                equalColumns={block.equalColumns ?? false}
                onChange={updated => updateCell(row, col, updated)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function GridCellEditor({
  label,
  cell,
  gridBlock,
  row,
  col,
  contentWidth,
  equalColumns,
  onChange,
}: {
  label: string;
  cell: GridCell;
  gridBlock: GridBlock;
  row: number;
  col: number;
  contentWidth: number;
  equalColumns: boolean;
  onChange: (cell: GridCell) => void;
}) {
  const selectId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const kind = getCellContentKind(cell);
  const block = cell.blocks[0];
  const colGap = gridBlock.gap ?? 8;
  const rowCells = gridBlock.cells[row] ?? [];
  const maxCellWidth = maxTextWidthInGridCell({
    contentWidth,
    columns: gridBlock.columns,
    colGap,
    rowCells,
    colIndex: col,
    equalColumns,
  });

  async function handleImageSelect(value: string) {
    if (value === 'upload') {
      fileInputRef.current?.click();
      return;
    }
    const sample = SAMPLE_IMAGES.find(img => img.id === value);
    if (!sample) return;
    setLoading(true);
    try {
      const dataUri = await urlToDataUri(sample.url);
      onChange(updateCellBlock(cell, { type: 'image', src: dataUri, width: 80, align: cell.align ?? 'center' }));
    } finally {
      setLoading(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLoading(true);
    try {
      const dataUri = await fileToDataUri(file);
      onChange(updateCellBlock(cell, { type: 'image', src: dataUri, width: 80, align: cell.align ?? 'center' }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid-cell">
      <strong>{label}</strong>
      <label htmlFor={selectId}>Content</label>
      <select
        id={selectId}
        value={kind}
        onChange={e => onChange(setCellContent(cell, e.target.value as 'empty' | 'text' | 'image'))}
      >
        <option value="empty">Empty</option>
        <option value="text">Text</option>
        <option value="image">Image</option>
      </select>

      <div className="row">
        <div>
          <label>H align</label>
          <select
            value={cell.align ?? ''}
            onChange={e => {
              const align = (e.target.value || undefined) as GridAlign | undefined;
              let next: GridCell = { ...cell, align };
              if (block?.type === 'text' && block.font?.align) {
                const { align: _fontAlign, ...fontRest } = block.font;
                const font = Object.keys(fontRest).length > 0 ? fontRest : undefined;
                next = { ...next, blocks: [{ ...block, font }] };
              }
              onChange(next);
            }}
          >
            <option value="">default</option>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        <div>
          <label>V align</label>
          <select
            value={cell.valign ?? ''}
            onChange={e => onChange({ ...cell, valign: (e.target.value || undefined) as GridValign | undefined })}
          >
            <option value="">default</option>
            <option value="top">Top</option>
            <option value="center">Center</option>
            <option value="bottom">Bottom</option>
          </select>
        </div>
      </div>

      {kind === 'text' && block?.type === 'text' && (
        <>
          <label>Text</label>
          <textarea
            rows={2}
            value={block.content}
            onChange={e => onChange(updateCellBlock(cell, { ...block, content: e.target.value }))}
          />
          <div className="row">
            <div>
              <label>Font</label>
              <FontFamilySelect
                value={block.font?.family}
                onChange={family => onChange(updateCellBlock(cell, { ...block, font: { ...block.font, family } }))}
              />
            </div>
            <div>
              <label>{ptLabel('Text width')}</label>
              <DeferredNumberInput
                min={1}
                max={maxCellWidth}
                placeholder="auto"
                value={block.width}
                emptyValue={undefined}
                onCommit={width => onChange(updateCellBlock(cell, {
                  ...block,
                  width: clampTextWidth(width, maxCellWidth),
                }))}
              />
            </div>
            <div>
              <label>{ptLabel('Font size')}</label>
              <DeferredNumberInput
                value={block.font?.size}
                onCommit={size => onChange(updateCellBlock(cell, { ...block, font: { ...block.font, size } }))}
              />
            </div>
            <div className="checkbox-row" style={{ alignSelf: 'flex-end', paddingBottom: 4 }}>
              <input
                type="checkbox"
                checked={block.font?.bold ?? false}
                onChange={e => onChange(updateCellBlock(cell, {
                  ...block,
                  font: { ...block.font, bold: e.target.checked },
                }))}
              />
              <label>Bold</label>
            </div>
          </div>
          <p className="section-hint" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
            Text width caps line wrapping only (max {maxCellWidth} pt in this row). Leave empty to use all space beside the image.
          </p>
        </>
      )}

      {kind === 'image' && block?.type === 'image' && (
        <>
          <label>Image</label>
          {!block.src && (
            <div className="error-banner" style={{ marginBottom: 6 }}>
              Select an image — empty images are skipped in the PDF.
            </div>
          )}
          <select
            defaultValue=""
            onChange={e => {
              if (e.target.value) handleImageSelect(e.target.value);
              e.target.value = '';
            }}
            disabled={loading}
          >
            <option value="">— Select image —</option>
            {SAMPLE_IMAGES.map(img => (
              <option key={img.id} value={img.id}>{img.label}</option>
            ))}
            <option value="upload">Upload from computer…</option>
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          {loading && <p className="section-hint"><span className="spinner" />Loading…</p>}
          {block.src && isDataUri(block.src) && (
            <img src={block.src} alt="Cell preview" className="image-preview" />
          )}
          <div className="row">
            <div>
              <label>{ptLabel('Width')}</label>
              <DeferredNumberInput
                min={1}
                max={maxCellWidth}
                value={block.width}
                onCommit={width => onChange(updateCellBlock(cell, {
                  ...block,
                  width: width !== undefined ? Math.min(width, maxCellWidth) : width,
                }))}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
