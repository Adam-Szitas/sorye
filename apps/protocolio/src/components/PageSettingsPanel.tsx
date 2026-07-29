import type { PageSettings, PageSize, FontStyle, PdfMetadata } from '@protocolio/sdk';
import * as TBS from '../services/templateBuilderService';
import DeferredNumberInput from './DeferredNumberInput';
import FontFamilySelect from './FontFamilySelect';
import { DEFAULT_MARGINS, DEFAULT_PAGE_SETTINGS, mergePageSettings } from '../defaults';
import { ptLabel, ratioLabel, colorLabel, COLOR_PLACEHOLDER, COLOR_FORMAT_HINT, LAYOUT_UNIT, LAYOUT_UNIT_HINT } from '../lib/units';

interface PageSettingsPanelProps {
  pageSettings: PageSettings | undefined;
  metadata: PdfMetadata | undefined;
  defaultFont: FontStyle | undefined;
  onChange: () => void;
}

const PAGE_SIZES: { label: string; value: string }[] = [
  { label: 'A4', value: 'A4' },
  { label: 'A3', value: 'A3' },
  { label: 'A5', value: 'A5' },
  { label: 'LETTER', value: 'LETTER' },
  { label: 'LEGAL', value: 'LEGAL' },
  { label: 'Custom', value: 'custom' },
];

export default function PageSettingsPanel({ pageSettings, metadata, defaultFont, onChange }: PageSettingsPanelProps) {
  const currentSize = pageSettings?.size;
  const isCustom = Array.isArray(currentSize);
  const sizeValue = isCustom ? 'custom' : (currentSize ?? '');

  function updatePage(patch: Partial<PageSettings>) {
    TBS.setPageSettings(mergePageSettings({ ...TBS.getPageSettings(), ...patch }));
    onChange();
  }

  function updateMargins(side: keyof typeof DEFAULT_MARGINS, value: number | undefined) {
    const current = TBS.getPageSettings();
    TBS.setPageSettings(mergePageSettings({
      ...current,
      margins: { ...current?.margins, [side]: value },
    }));
    onChange();
  }

  function updateMeta(patch: Partial<PdfMetadata>) {
    TBS.setMetadata({ ...metadata, ...patch });
    onChange();
  }

  function updateFont(patch: Partial<FontStyle>) {
    TBS.setDefaultFont({ ...defaultFont, ...patch });
    onChange();
  }

  function handleSizeChange(val: string) {
    if (val === 'custom') {
      updatePage({ size: [595, 842] });
    } else if (val === '') {
      const { size: _s, ...rest } = pageSettings ?? {};
      TBS.setPageSettings(Object.keys(rest).length > 0 ? rest : undefined);
      onChange();
    } else {
      updatePage({ size: val as PageSize });
    }
  }

  return (
    <div className="section">
      <h2>Page Settings</h2>
      <p className="section-hint" style={{ margin: '0 0 8px', fontSize: '0.75rem' }}>
        {LAYOUT_UNIT_HINT}
      </p>
      <div className="row">
        <div>
          <label>Page Size</label>
          <select value={sizeValue} onChange={e => handleSizeChange(e.target.value)}>
            <option value="">default</option>
            {PAGE_SIZES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {isCustom && (
          <>
            <div>
              <label>{ptLabel('Width')}</label>
              <DeferredNumberInput
                min={1}
                value={(currentSize as [number, number])[0]}
                emptyValue={595}
                onCommit={w => updatePage({ size: [w ?? 595, (currentSize as [number, number])[1]] })}
              />
            </div>
            <div>
              <label>{ptLabel('Height')}</label>
              <DeferredNumberInput
                min={1}
                value={(currentSize as [number, number])[1]}
                emptyValue={842}
                onCommit={h => updatePage({ size: [(currentSize as [number, number])[0], h ?? 842] })}
              />
            </div>
          </>
        )}
        <div>
          <label>Orientation</label>
          <select value={pageSettings?.orientation ?? ''} onChange={e => updatePage({ orientation: (e.target.value || undefined) as PageSettings['orientation'] })}>
            <option value="">default</option><option value="portrait">portrait</option><option value="landscape">landscape</option>
          </select>
        </div>
      </div>

      <h3>Margins ({LAYOUT_UNIT})</h3>
      <p className="section-hint" style={{ margin: '0 0 8px', fontSize: '0.75rem' }}>
        Default left/right is 20 pt (~7 mm).
      </p>
      <div className="row">
        <div>
          <label>{ptLabel('Top')}</label>
          <DeferredNumberInput
            min={0}
            value={pageSettings?.margins?.top}
            emptyValue={DEFAULT_MARGINS.top}
            onCommit={top => updateMargins('top', top)}
          />
        </div>
        <div>
          <label>{ptLabel('Right')}</label>
          <DeferredNumberInput
            min={0}
            value={pageSettings?.margins?.right}
            emptyValue={DEFAULT_MARGINS.right}
            onCommit={right => updateMargins('right', right)}
          />
        </div>
        <div>
          <label>{ptLabel('Bottom')}</label>
          <DeferredNumberInput
            min={0}
            value={pageSettings?.margins?.bottom}
            emptyValue={DEFAULT_MARGINS.bottom}
            onCommit={bottom => updateMargins('bottom', bottom)}
          />
        </div>
        <div>
          <label>{ptLabel('Left')}</label>
          <DeferredNumberInput
            min={0}
            value={pageSettings?.margins?.left}
            emptyValue={DEFAULT_MARGINS.left}
            onCommit={left => updateMargins('left', left)}
          />
        </div>
      </div>

      <h3>Content area</h3>
      <div className="row">
        <div>
          <label>{ptLabel('Bottom content reserve')}</label>
          <DeferredNumberInput
            min={0}
            placeholder="0"
            value={pageSettings?.contentBottomReserve}
            onCommit={contentBottomReserve => updatePage({ contentBottomReserve })}
          />
          <p className="section-hint" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
            Extra space above the bottom margin where body content cannot flow (e.g. footer or letterhead area)
          </p>
        </div>
      </div>

      <h3>Block spacing</h3>
      <div className="row">
        <div>
          <label>{ptLabel('Default block gap')}</label>
          <DeferredNumberInput
            min={0}
            placeholder="0"
            value={pageSettings?.defaultBlockGap}
            onCommit={defaultBlockGap => updatePage({ defaultBlockGap })}
          />
          <p className="section-hint" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
            Vertical space between each block on the page (PDF output and block list preview)
          </p>
        </div>
      </div>

      <h3>Layout direction</h3>
      <div className="checkbox-row">
        <input
          type="checkbox"
          id="page-inverse"
          checked={pageSettings?.inverse ?? false}
          onChange={e => updatePage({ inverse: e.target.checked || undefined })}
        />
        <label htmlFor="page-inverse">Inverse (stack blocks from bottom)</label>
      </div>
      <p className="section-hint" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
        When enabled, the first block sits on the bottom margin and each new block is placed above it.
      </p>

      <h3>Grid defaults</h3>
      <div className="row">
        <div>
          <label>{ptLabel('Default row gap')}</label>
          <DeferredNumberInput
            min={0}
            placeholder="12"
            value={pageSettings?.defaultRowGap}
            emptyValue={DEFAULT_PAGE_SETTINGS.defaultRowGap}
            onCommit={defaultRowGap => updatePage({ defaultRowGap })}
          />
          <p className="section-hint" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
            Used by grid blocks that leave row gap empty
          </p>
        </div>
      </div>

      <h3>Table of contents</h3>
      <div className="checkbox-row">
        <input
          type="checkbox"
          checked={pageSettings?.includeToc ?? false}
          onChange={e => updatePage({ includeToc: e.target.checked || undefined })}
        />
        <label>Include TOC page</label>
      </div>
      <p className="section-hint" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
        Prepends a contents page. Blocks with a TOC label list their page number.
      </p>

      <h3>Metadata</h3>
      <div className="row">
        <div><label>Title</label><input type="text" value={metadata?.title ?? ''} onChange={e => updateMeta({ title: e.target.value || undefined })} /></div>
        <div><label>Author</label><input type="text" value={metadata?.author ?? ''} onChange={e => updateMeta({ author: e.target.value || undefined })} /></div>
      </div>
      <div className="row">
        <div><label>Subject</label><input type="text" value={metadata?.subject ?? ''} onChange={e => updateMeta({ subject: e.target.value || undefined })} /></div>
        <div><label>Keywords (comma-separated)</label><input type="text" value={metadata?.keywords?.join(', ') ?? ''} onChange={e => updateMeta({ keywords: e.target.value ? e.target.value.split(',').map(k => k.trim()) : undefined })} /></div>
        <div><label>Creator</label><input type="text" value={metadata?.creator ?? ''} onChange={e => updateMeta({ creator: e.target.value || undefined })} /></div>
      </div>

      <h3>Default Font</h3>
      <p className="section-hint" style={{ margin: '0 0 8px', fontSize: '0.75rem' }}>
        {COLOR_FORMAT_HINT} Use <strong>DejaVu Sans</strong> (default) for Hungarian and full Unicode; Helvetica/Times miss ő and ű.
      </p>
      <div className="row">
        <div>
          <label>Family</label>
          <FontFamilySelect
            value={defaultFont?.family}
            allowDefault={false}
            onChange={family => updateFont({ family: family ?? 'DejaVu Sans' })}
          />
        </div>
        <div><label>{ptLabel('Size')}</label><DeferredNumberInput value={defaultFont?.size} onCommit={size => updateFont({ size })} /></div>
        <div><label>{colorLabel('Color')}</label><input type="text" placeholder={COLOR_PLACEHOLDER} value={defaultFont?.color ?? ''} onChange={e => updateFont({ color: e.target.value || undefined })} /></div>
      </div>
      <div className="row">
        <div className="checkbox-row"><input type="checkbox" checked={defaultFont?.bold ?? false} onChange={e => updateFont({ bold: e.target.checked })} /><label>Bold</label></div>
        <div className="checkbox-row"><input type="checkbox" checked={defaultFont?.italic ?? false} onChange={e => updateFont({ italic: e.target.checked })} /><label>Italic</label></div>
        <div className="checkbox-row"><input type="checkbox" checked={defaultFont?.underline ?? false} onChange={e => updateFont({ underline: e.target.checked })} /><label>Underline</label></div>
      </div>
      <div className="row">
        <div><label>{ptLabel('Line height')}</label><DeferredNumberInput value={defaultFont?.lineHeight} onCommit={lineHeight => updateFont({ lineHeight })} /></div>
        <div>
          <label>Align</label>
          <select value={defaultFont?.align ?? ''} onChange={e => updateFont({ align: (e.target.value || undefined) as FontStyle['align'] })}>
            <option value="">default</option><option value="left">left</option><option value="center">center</option><option value="right">right</option><option value="justify">justify</option>
          </select>
        </div>
        <div><label>{ratioLabel('Opacity')}</label><DeferredNumberInput step={0.1} min={0} max={1} value={defaultFont?.opacity} onCommit={opacity => updateFont({ opacity })} /></div>
      </div>
    </div>
  );
}
