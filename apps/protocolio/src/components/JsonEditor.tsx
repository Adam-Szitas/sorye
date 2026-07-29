import { useEffect, useState } from 'react';
import type { PdfTemplate } from '@protocolio/sdk';

interface JsonEditorProps {
  mode: 'visual' | 'json';
  /** Live preview from the visual builder */
  builderJson?: string;
  /** Initial JSON when opening the editor (json mode) */
  initialJson?: string;
  onTemplateChange: (template: PdfTemplate | null, raw: string) => void;
  parseError: string | undefined;
  /** Show a shorter preview instead of the full editor height */
  compact?: boolean;
}

export default function JsonEditor({
  mode,
  builderJson = '{}',
  initialJson,
  onTemplateChange,
  parseError,
  compact = false,
}: JsonEditorProps) {
  const isReadOnly = mode === 'visual';
  const [raw, setRaw] = useState(initialJson ?? builderJson);

  useEffect(() => {
    if (mode === 'visual') {
      setRaw(builderJson);
    }
  }, [mode, builderJson]);

  // Reset editor content when parent remounts (e.g. preset loaded) via key prop
  useEffect(() => {
    if (mode === 'json' && initialJson !== undefined) {
      setRaw(initialJson);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when remounted via key
  }, []);

  function handleChange(value: string) {
    setRaw(value);
    try {
      const parsed = JSON.parse(value) as PdfTemplate;
      onTemplateChange(parsed, value);
    } catch {
      onTemplateChange(null, value);
    }
  }

  return (
    <div className="section">
      <h2>{isReadOnly ? 'Payload JSON (Preview)' : 'Payload JSON (Editor)'}</h2>
      {!compact && (
        <p className="section-hint">
        This is the <code>PdfTemplate</code> payload sent to <code>POST /api/generate</code>.
        </p>
      )}
      {parseError && <div className="error-banner">Parse Error: {parseError}</div>}
      <textarea
        rows={compact ? 10 : 24}
        value={isReadOnly ? builderJson : raw}
        onChange={e => handleChange(e.target.value)}
        readOnly={isReadOnly}
        className={`json-textarea${isReadOnly ? ' readonly' : ''}`}
        spellCheck={false}
      />
    </div>
  );
}
