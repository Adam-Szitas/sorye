import type { PdfTemplate } from '@protocolio/sdk';
import { presets } from '../presets';

interface PresetSelectorProps {
  onSelect: (template: PdfTemplate) => void;
}

export default function PresetSelector({ onSelect }: PresetSelectorProps) {
  return (
    <div className="section">
      <h2>Presets</h2>
      <p className="section-hint">Load a starter template, then edit the JSON below.</p>
      <div className="preset-grid">
        {presets.map(p => (
          <button key={p.id} type="button" className="preset-card" onClick={() => onSelect(p.template)}>
            <strong>{p.label}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}
