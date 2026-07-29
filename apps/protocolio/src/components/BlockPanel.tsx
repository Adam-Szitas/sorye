import { useState, useRef, useId } from 'react';
import type {
  Block, TextBlock, ImageBlock, DividerBlock,
  SpacerBlock, ShapeBlock, ColumnsBlock, GridBlock, HeaderFooterBlock, AttachPdfBlock,
  BlockLayout, PageSettings,
} from '@protocolio/sdk';
import * as TBS from '../services/templateBuilderService';
import { SAMPLE_IMAGES, fileToDataUri, urlToDataUri, isDataUri } from '../lib/sampleImages';
import { defaultGridBlock } from '../lib/gridUtils';
import GridConfig from './GridConfig';
import TableConfig from './TableConfig';
import MergedTableConfig from './MergedTableConfig';
import { defaultMergedTableBlock } from '../lib/mergedTableUtils';
import DeferredNumberInput from './DeferredNumberInput';
import FontFamilySelect from './FontFamilySelect';
import { ptLabel, ptOrPercentLabel, colorLabel, COLOR_PLACEHOLDER, LAYOUT_UNIT } from '../lib/units';
import { readHeaderFooterSlots, writeHeaderFooterSlot, defaultHeaderFooterBlock, isHeaderFooterRepeating, readHeaderFooterPages, updateHeaderFooterPageSlot, addHeaderFooterPage, removeHeaderFooterPage, setHeaderFooterRepeating, countHeaderFootersSamePosition, ordinalPageAmongSamePosition } from '../lib/headerFooterUtils';
import { resolveContentWidth } from '../defaults';

const BLOCK_TYPES = [
  'text', 'image', 'table', 'mergedTable', 'grid', 'divider', 'spacer',
  'pageBreak', 'shape', 'columns', 'headerFooter', 'attachPdf',
] as const;

type BlockType = typeof BLOCK_TYPES[number];

interface BlockPanelProps {
  blocks: readonly Block[];
  defaultRowGap?: number;
  defaultBlockGap?: number;
  inverse?: boolean;
  pageSettings?: PageSettings;
  onChange: () => void;
}

function defaultBlock(type: BlockType): Block {
  switch (type) {
    case 'text': return { type: 'text', content: 'Hello World' };
    case 'image': return { type: 'image', src: '' };
    case 'table': return {
      type: 'table',
      columns: [{ header: 'Column 1', align: 'left' }],
      rows: [],
      showBorder: true,
      columnGap: 0,
      rowGap: 0,
    };
    case 'mergedTable': return defaultMergedTableBlock();
    case 'grid': return defaultGridBlock();
    case 'divider': return { type: 'divider' };
    case 'spacer': return { type: 'spacer', height: 20 };
    case 'pageBreak': return { type: 'pageBreak' };
    case 'shape': return { type: 'shape', shape: 'rect', width: 100, height: 50 };
    case 'columns': return { type: 'columns', columns: [{ blocks: [{ type: 'text', content: 'Col 1' }] }, { blocks: [{ type: 'text', content: 'Col 2' }] }] };
    case 'headerFooter': return defaultHeaderFooterBlock('header');
    case 'attachPdf': return { type: 'attachPdf', data: '', position: 'after' };
  }
}

export default function BlockPanel({ blocks, defaultRowGap, defaultBlockGap, inverse, pageSettings, onChange }: BlockPanelProps) {
  const contentWidth = resolveContentWidth(pageSettings);
  const [addType, setAddType] = useState<BlockType>('text');

  function handleAdd() {
    if (addType === 'headerFooter') {
      const existing = blocks.filter(b => b.type === 'headerFooter') as HeaderFooterBlock[];
      if (existing.length === 0) {
        TBS.addBlock(defaultHeaderFooterBlock('header'));
      } else {
        const footers = existing.filter(b => b.position === 'footer').length;
        TBS.addBlock(defaultHeaderFooterBlock('footer', { page: footers + 1, repeat: false }));
      }
    } else {
      TBS.addBlock(defaultBlock(addType));
    }
    onChange();
  }

  function handleRemove(index: number) {
    TBS.removeBlock(index);
    onChange();
  }

  function handleMoveUp(index: number) {
    if (index > 0) { TBS.moveBlock(index, index - 1); onChange(); }
  }

  function handleMoveDown(index: number) {
    if (index < blocks.length - 1) { TBS.moveBlock(index, index + 1); onChange(); }
  }

  function updateBlock(index: number, updated: Block) {
    TBS.replaceBlock(index, updated);
    onChange();
  }

  return (
    <div className="section">
      <h2>Blocks</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={addType} onChange={e => setAddType(e.target.value as BlockType)}>
          {BLOCK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={handleAdd} className="primary">Add Block</button>
      </div>
      {blocks.length === 0 ? (
        <p style={{ color: '#888', fontSize: '0.85rem' }}>No blocks added yet.</p>
      ) : (
        <div
          className={`block-list${inverse ? ' block-list-inverse' : ''}`}
          style={{ gap: `${defaultBlockGap ?? 0}px` }}
        >
          {blocks.map((block, i) => {
            const anchorIdx = segmentAnchorIndex(blocks, i);
            const isBottomAnchored = anchorIdx !== -1 && i >= anchorIdx;
            return (
            <div key={i} className={`block-card${isBottomAnchored ? ' block-card-bottom-anchored' : ''}`}>
              <div className="block-card-header">
                <strong>{block.type}</strong>
                <div className="block-card-actions">
                  <button onClick={() => handleMoveUp(i)} disabled={i === 0}>↑</button>
                  <button onClick={() => handleMoveDown(i)} disabled={i === blocks.length - 1}>↓</button>
                  <button className="danger" onClick={() => handleRemove(i)}>✕</button>
                </div>
              </div>
              <BlockLayoutControls block={block} onChange={updated => updateBlock(i, updated)} />
              <BlockConfigForm
                block={block}
                blockIndex={i}
                allBlocks={blocks}
                defaultRowGap={defaultRowGap}
                contentWidth={contentWidth}
                onChange={updated => updateBlock(i, updated)}
              />
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


const LAYOUT_BLOCK_TYPES = new Set(['text', 'image', 'table', 'mergedTable', 'grid', 'divider', 'spacer', 'shape', 'columns']);

/** First anchorBottom index within the page segment that contains blockIndex */
function segmentAnchorIndex(blocks: readonly Block[], blockIndex: number): number {
  let segmentStart = 0;
  for (let j = 0; j < blockIndex; j++) {
    if (blocks[j]?.type === 'pageBreak') segmentStart = j + 1;
  }

  let segmentEnd = blocks.length;
  for (let j = blockIndex + 1; j < blocks.length; j++) {
    if (blocks[j]?.type === 'pageBreak') {
      segmentEnd = j;
      break;
    }
  }

  for (let j = segmentStart; j < segmentEnd; j++) {
    if ((blocks[j] as Block & BlockLayout).anchorBottom) return j;
  }
  return -1;
}

function BlockLayoutControls({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  if (!LAYOUT_BLOCK_TYPES.has(block.type)) return null;

  const layout = block as Block & BlockLayout;

  function updateLayout(patch: Partial<BlockLayout>) {
    onChange({ ...block, ...patch } as Block);
  }

  return (
    <div className="row" style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
      <div className="checkbox-row">
        <input
          type="checkbox"
          checked={layout.anchorBottom ?? false}
          onChange={e => updateLayout({ anchorBottom: e.target.checked || undefined })}
        />
        <label>Anchor from page bottom (until next page break)</label>
      </div>
      <div className="checkbox-row">
        <input
          type="checkbox"
          checked={layout.pageBreakBefore ?? false}
          onChange={e => updateLayout({ pageBreakBefore: e.target.checked || undefined })}
        />
        <label>Start on new page</label>
      </div>
      <div style={{ flex: 1 }}>
        <label>TOC label</label>
        <input
          type="text"
          placeholder="Shown in table of contents"
          value={layout.tocLabel ?? ''}
          onChange={e => updateLayout({ tocLabel: e.target.value || undefined })}
        />
      </div>
      <div>
        <label>{ptLabel('Margin top')}</label>
        <DeferredNumberInput
          min={0}
          placeholder="0"
          value={layout.marginTop}
          emptyValue={0}
          onCommit={marginTop => updateLayout({ marginTop: marginTop || undefined })}
        />
      </div>
    </div>
  );
}

function BlockConfigForm({
  block,
  blockIndex,
  allBlocks,
  defaultRowGap,
  contentWidth,
  onChange,
}: {
  block: Block;
  blockIndex: number;
  allBlocks: readonly Block[];
  defaultRowGap?: number;
  contentWidth: number;
  onChange: (b: Block) => void;
}) {
  switch (block.type) {
    case 'text': return <TextConfig block={block} onChange={onChange} />;
    case 'image': return <ImageConfig block={block} onChange={onChange} />;
    case 'table': return <TableConfig block={block} onChange={onChange} />;
    case 'mergedTable': return <MergedTableConfig block={block} onChange={onChange} />;
    case 'grid': return <GridConfig block={block as GridBlock} defaultRowGap={defaultRowGap} contentWidth={contentWidth} onChange={onChange} />;
    case 'divider': return <DividerConfig block={block} onChange={onChange} />;
    case 'spacer': return <SpacerConfig block={block} onChange={onChange} />;
    case 'pageBreak': return <p style={{ fontSize: '0.8rem', color: '#888' }}>No configuration needed.</p>;
    case 'shape': return <ShapeConfig block={block} onChange={onChange} />;
    case 'columns': return <ColumnsConfig block={block} onChange={onChange} />;
    case 'headerFooter': return (
      <HeaderFooterConfig
        block={block}
        blockIndex={blockIndex}
        allBlocks={allBlocks}
        onChange={onChange}
      />
    );
    case 'attachPdf': return <AttachPdfConfig block={block} onChange={onChange} />;
    default: return null;
  }
}

function TextConfig({ block, onChange }: { block: TextBlock; onChange: (b: Block) => void }) {
  return (
    <div>
      <label>Content</label>
      <textarea rows={3} value={block.content} onChange={e => onChange({ ...block, content: e.target.value })} />
      <div className="row">
        <div>
          <label>Font Family</label>
          <FontFamilySelect
            value={block.font?.family}
            onChange={family => onChange({ ...block, font: { ...block.font, family } })}
          />
        </div>
        <div><label>{ptLabel('Size')}</label><DeferredNumberInput value={block.font?.size} onCommit={size => onChange({ ...block, font: { ...block.font, size } })} /></div>
        <div><label>{colorLabel('Color')}</label><input type="text" placeholder={COLOR_PLACEHOLDER} value={block.font?.color ?? ''} onChange={e => onChange({ ...block, font: { ...block.font, color: e.target.value || undefined } })} /></div>
      </div>
      <div className="row">
        <div className="checkbox-row"><input type="checkbox" checked={block.font?.bold ?? false} onChange={e => onChange({ ...block, font: { ...block.font, bold: e.target.checked } })} /><label>Bold</label></div>
        <div className="checkbox-row"><input type="checkbox" checked={block.font?.italic ?? false} onChange={e => onChange({ ...block, font: { ...block.font, italic: e.target.checked } })} /><label>Italic</label></div>
        <div className="checkbox-row"><input type="checkbox" checked={block.font?.underline ?? false} onChange={e => onChange({ ...block, font: { ...block.font, underline: e.target.checked } })} /><label>Underline</label></div>
        <div>
          <label>Align</label>
          <select value={block.font?.align ?? ''} onChange={e => onChange({ ...block, font: { ...block.font, align: (e.target.value || undefined) as TextBlock['font'] extends { align?: infer A } ? A : never } })}>
            <option value="">default</option><option value="left">left</option><option value="center">center</option><option value="right">right</option><option value="justify">justify</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function ImageConfig({ block, onChange }: { block: ImageBlock; onChange: (b: Block) => void }) {
  const selectId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');

  async function handleSelectChange(value: string) {
    setError('');
    if (value === '') {
      setSelectedId('');
      onChange({ ...block, src: '' });
      return;
    }
    if (value === 'upload') {
      fileInputRef.current?.click();
      return;
    }

    const sample = SAMPLE_IMAGES.find(img => img.id === value);
    if (!sample) return;

    setLoading(true);
    setSelectedId(value);
    try {
      const dataUri = await urlToDataUri(sample.url);
      onChange({ ...block, src: dataUri });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load image');
      setSelectedId('');
    } finally {
      setLoading(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError('');
    setLoading(true);
    setSelectedId('upload');
    try {
      const dataUri = await fileToDataUri(file);
      onChange({ ...block, src: dataUri });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file');
      setSelectedId('');
    } finally {
      setLoading(false);
    }
  }

  const previewSrc = block.src && (isDataUri(block.src) || block.src.startsWith('http')) ? block.src : '';

  return (
    <div>
      <label htmlFor={selectId}>Image Source</label>
      <select
        id={selectId}
        value={selectedId}
        onChange={e => handleSelectChange(e.target.value)}
        disabled={loading}
      >
        <option value="">— Select an image —</option>
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
      {loading && <p className="section-hint"><span className="spinner" />Loading image…</p>}
      {error && <div className="error-banner">{error}</div>}
      {block.src && !loading && (
        <p className="section-hint">
          {selectedId === 'upload' ? 'Using uploaded file' : selectedId ? `Using ${SAMPLE_IMAGES.find(i => i.id === selectedId)?.label ?? 'sample'}` : 'Custom image embedded as base64'}
        </p>
      )}
      {previewSrc && (
        <img src={previewSrc} alt="Preview" className="image-preview" />
      )}
      <p className="section-hint" style={{ margin: '0 0 8px', fontSize: '0.75rem' }}>
        Width/height are in {LAYOUT_UNIT}. Width is clamped to the printable area (page width minus margins).
      </p>
      <div className="row">
        <div><label>{ptLabel('Width')}</label><DeferredNumberInput min={1} value={block.width} onCommit={width => onChange({ ...block, width })} /></div>
        <div><label>{ptLabel('Height')}</label><DeferredNumberInput min={1} value={block.height} onCommit={height => onChange({ ...block, height })} /></div>
        <div>
          <label>Fit</label>
          <select value={block.fit ?? ''} onChange={e => onChange({ ...block, fit: (e.target.value || undefined) as ImageBlock['fit'] })}>
            <option value="">default</option><option value="contain">contain</option><option value="cover">cover</option><option value="stretch">stretch</option>
          </select>
        </div>
        <div>
          <label>Align</label>
          <select value={block.align ?? ''} onChange={e => onChange({ ...block, align: (e.target.value || undefined) as ImageBlock['align'] })}>
            <option value="">default</option><option value="left">left</option><option value="center">center</option><option value="right">right</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function DividerConfig({ block, onChange }: { block: DividerBlock; onChange: (b: Block) => void }) {
  return (
    <div className="row">
      <div><label>{ptLabel('Thickness')}</label><DeferredNumberInput min={0} value={block.thickness} onCommit={thickness => onChange({ ...block, thickness })} /></div>
      <div><label>{colorLabel('Color')}</label><input type="text" placeholder={COLOR_PLACEHOLDER} value={block.color ?? ''} onChange={e => onChange({ ...block, color: e.target.value || undefined })} /></div>
      <div><label>{ptLabel('Margin')}</label><DeferredNumberInput min={0} value={block.margin} emptyValue={10} onCommit={margin => onChange({ ...block, margin })} /></div>
    </div>
  );
}

function SpacerConfig({ block, onChange }: { block: SpacerBlock; onChange: (b: Block) => void }) {
  return (
    <div className="row">
      <div><label>{ptLabel('Height')}</label><DeferredNumberInput min={0} value={block.height} emptyValue={20} onCommit={height => onChange({ ...block, height: height ?? 0 })} /></div>
    </div>
  );
}

function ShapeConfig({ block, onChange }: { block: ShapeBlock; onChange: (b: Block) => void }) {
  return (
    <div>
      <div className="row">
        <div>
          <label>Shape</label>
          <select value={block.shape} onChange={e => onChange({ ...block, shape: e.target.value as ShapeBlock['shape'] })}>
            <option value="rect">rect</option><option value="circle">circle</option><option value="line">line</option>
          </select>
        </div>
        <div><label>{ptLabel('X')}</label><DeferredNumberInput value={block.x} onCommit={x => onChange({ ...block, x })} /></div>
        <div><label>{ptLabel('Y')}</label><DeferredNumberInput value={block.y} onCommit={y => onChange({ ...block, y })} /></div>
      </div>
      <div className="row">
        <div><label>{ptLabel('Width')}</label><DeferredNumberInput min={0} value={block.width} onCommit={width => onChange({ ...block, width })} /></div>
        <div><label>{ptLabel('Height')}</label><DeferredNumberInput min={0} value={block.height} onCommit={height => onChange({ ...block, height })} /></div>
        <div><label>{colorLabel('Fill')}</label><input type="text" placeholder={COLOR_PLACEHOLDER} value={block.fill ?? ''} onChange={e => onChange({ ...block, fill: e.target.value || undefined })} /></div>
        <div><label>{colorLabel('Stroke')}</label><input type="text" placeholder={COLOR_PLACEHOLDER} value={block.stroke ?? ''} onChange={e => onChange({ ...block, stroke: e.target.value || undefined })} /></div>
        <div><label>{ptLabel('Stroke width')}</label><DeferredNumberInput min={0} value={block.strokeWidth} onCommit={strokeWidth => onChange({ ...block, strokeWidth })} /></div>
      </div>
    </div>
  );
}

function ColumnsConfig({ block, onChange }: { block: ColumnsBlock; onChange: (b: Block) => void }) {
  return (
    <div>
      <div className="row">
        <div><label>{ptLabel('Gap')}</label><DeferredNumberInput min={0} value={block.gap} onCommit={gap => onChange({ ...block, gap })} /></div>
      </div>
      {block.columns.map((col, ci) => (
        <div key={ci} style={{ marginTop: 4, paddingLeft: 8, borderLeft: '2px solid #ddd' }}>
          <label>{ptOrPercentLabel(`Column ${ci + 1} width`)}</label>
          <input type="text" value={col.width ?? ''} onChange={e => {
            const cols = [...block.columns];
            cols[ci] = { ...cols[ci]!, width: e.target.value || undefined };
            onChange({ ...block, columns: cols });
          }} placeholder="e.g. 50% or 200" />
          <label>First block content</label>
          <input type="text" value={col.blocks[0]?.type === 'text' ? (col.blocks[0] as TextBlock).content : ''} onChange={e => {
            const cols = [...block.columns];
            cols[ci] = { ...cols[ci]!, blocks: [{ type: 'text', content: e.target.value }] };
            onChange({ ...block, columns: cols });
          }} />
        </div>
      ))}
      <button style={{ marginTop: 4 }} onClick={() => onChange({ ...block, columns: [...block.columns, { blocks: [{ type: 'text', content: '' }] }] })}>+ Column</button>
    </div>
  );
}

function HeaderFooterConfig({
  block,
  blockIndex,
  allBlocks,
  onChange,
}: {
  block: HeaderFooterBlock;
  blockIndex: number;
  allBlocks: readonly Block[];
  onChange: (b: Block) => void;
}) {
  const siblingCount = countHeaderFootersSamePosition(allBlocks, block);
  const multiBlock = siblingCount > 1;
  const repeating = !multiBlock && isHeaderFooterRepeating(block);
  const slots = readHeaderFooterSlots(block);
  const pageSlots = readHeaderFooterPages(block);
  const defaultPage = block.page ?? ordinalPageAmongSamePosition(allBlocks, block, blockIndex);

  // For a multi-block footer the engine renders this block's own left/center/right
  // (block.blocks) on its assigned PDF page. Editing must therefore target block.blocks;
  // we also drop any stale block.pages left over from earlier edits so the data matches
  // what actually gets rendered.
  function commitSlot(slot: 'left' | 'center' | 'right', value: string) {
    const next = writeHeaderFooterSlot(block, slot, value);
    onChange(multiBlock ? { ...next, pages: undefined } : next);
  }

  return (
    <div>
      <div className="row">
        <div>
          <label>Position</label>
          <select value={block.position} onChange={e => onChange({ ...block, position: e.target.value as 'header' | 'footer' })}>
            <option value="header">header</option><option value="footer">footer</option>
          </select>
        </div>
        <div><label>{ptLabel('Height')}</label><DeferredNumberInput min={0} value={block.height} onCommit={height => onChange({ ...block, height })} /></div>
        {multiBlock && (
          <div>
            <label>PDF page</label>
            <DeferredNumberInput
              min={1}
              value={defaultPage}
              emptyValue={defaultPage}
              onCommit={page => onChange({ ...block, page, repeat: false, pages: undefined })}
            />
          </div>
        )}
      </div>
      {!multiBlock && (
        <div className="checkbox-row" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={repeating}
            onChange={e => onChange(setHeaderFooterRepeating(block, e.target.checked))}
          />
          <label>Same on every page</label>
        </div>
      )}
      <p className="section-hint" style={{ margin: '0 0 8px', fontSize: '0.75rem' }}>
        {multiBlock
          ? 'Multiple header/footer blocks: each block is shown on one PDF page only (set PDF page above). Use one block with “Same on every page” to repeat on all pages.'
          : repeating
            ? 'Left, center, and right columns repeat on every page. Use {{pageNumber}} and {{totalPages}} for dynamic values.'
            : 'Define a separate footer/header for each PDF page (page 1, page 2, …). Add one row per page in your document.'}
      </p>
      {repeating || multiBlock ? (
        <>
          <label>Left</label>
          <input
            type="text"
            value={slots.left}
            onChange={e => commitSlot('left', e.target.value)}
            placeholder="Left-aligned text"
          />
          <label>Center</label>
          <input
            type="text"
            value={slots.center}
            onChange={e => commitSlot('center', e.target.value)}
            placeholder="Centered text"
          />
          <label>Right</label>
          <input
            type="text"
            value={slots.right}
            onChange={e => commitSlot('right', e.target.value)}
            placeholder="Right-aligned text"
          />
        </>
      ) : (
        <>
          {pageSlots.map((page, pageIndex) => (
            <div key={pageIndex} className="header-footer-page" style={{ marginBottom: 12, padding: 8, border: '1px solid #ddd', borderRadius: 4, background: '#fafafa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong style={{ fontSize: '0.85rem' }}>Page {pageIndex + 1}</strong>
                {pageSlots.length > 1 && (
                  <button type="button" onClick={() => onChange(removeHeaderFooterPage(block, pageIndex))}>Remove</button>
                )}
              </div>
              <label>Left</label>
              <input
                type="text"
                value={page.left}
                onChange={e => onChange(updateHeaderFooterPageSlot(block, pageIndex, 'left', e.target.value))}
                placeholder="Left-aligned text"
              />
              <label>Center</label>
              <input
                type="text"
                value={page.center}
                onChange={e => onChange(updateHeaderFooterPageSlot(block, pageIndex, 'center', e.target.value))}
                placeholder="Centered text"
              />
              <label>Right</label>
              <input
                type="text"
                value={page.right}
                onChange={e => onChange(updateHeaderFooterPageSlot(block, pageIndex, 'right', e.target.value))}
                placeholder="Right-aligned text"
              />
            </div>
          ))}
          <button type="button" onClick={() => onChange(addHeaderFooterPage(block))}>+ Page</button>
        </>
      )}
    </div>
  );
}

function AttachPdfConfig({ block, onChange }: { block: AttachPdfBlock; onChange: (b: Block) => void }) {
  return (
    <div>
      <label>Base64 PDF Data</label>
      <textarea rows={3} value={block.data} onChange={e => onChange({ ...block, data: e.target.value })} placeholder="Paste base64-encoded PDF..." />
      <label>Position</label>
      <select value={block.position ?? 'after'} onChange={e => onChange({ ...block, position: e.target.value as 'before' | 'after' })}>
        <option value="before">before</option><option value="after">after</option>
      </select>
    </div>
  );
}
