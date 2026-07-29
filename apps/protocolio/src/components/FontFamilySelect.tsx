import { FONT_OPTIONS, findFontOptionByFamily } from '@protocolio/sdk';

interface FontFamilySelectProps {
  value?: string;
  onChange: (family: string | undefined) => void;
  allowDefault?: boolean;
  id?: string;
}

function resolveSelectedId(family: string | undefined): string {
  if (!family?.trim()) return '';
  const match = findFontOptionByFamily(family);
  if (match) return match.id;
  return `__custom__:${family}`;
}

export default function FontFamilySelect({
  value,
  onChange,
  allowDefault = true,
  id,
}: FontFamilySelectProps) {
  const selectValue = resolveSelectedId(value);
  const isCustom = selectValue.startsWith('__custom__:');

  return (
    <>
      <select
        id={id}
        value={isCustom ? selectValue : selectValue}
        onChange={e => {
          const next = e.target.value;
          if (next === '') {
            onChange(undefined);
            return;
          }
          if (next.startsWith('__custom__:')) {
            onChange(next.slice('__custom__:'.length));
            return;
          }
          const opt = FONT_OPTIONS.find(f => f.id === next);
          onChange(opt?.family);
        }}
      >
        {allowDefault && <option value="">Default</option>}
        <optgroup label="Sans-serif">
          {FONT_OPTIONS.filter(f => f.group === 'sans').map(f => (
            <option key={f.id} value={f.id}>
              {f.label}{f.unicode ? '' : ' (Latin only)'}
            </option>
          ))}
        </optgroup>
        <optgroup label="Serif">
          {FONT_OPTIONS.filter(f => f.group === 'serif').map(f => (
            <option key={f.id} value={f.id}>{f.label} (Latin only)</option>
          ))}
        </optgroup>
        <optgroup label="Monospace">
          {FONT_OPTIONS.filter(f => f.group === 'mono').map(f => (
            <option key={f.id} value={f.id}>{f.label} (Latin only)</option>
          ))}
        </optgroup>
        {isCustom && (
          <option value={selectValue}>Custom: {value}</option>
        )}
      </select>
      <p className="section-hint" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
        Use DejaVu Sans for Hungarian and other special characters. Other fonts are PDF standard (Latin).
      </p>
    </>
  );
}
