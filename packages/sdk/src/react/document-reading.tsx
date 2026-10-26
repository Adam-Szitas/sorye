'use client';

import { useId, useState } from 'react';
import './document-reading.css';

/** A content-only JSON disclosure. Serialization happens only when requested. */
export function JsonDocument({ value, fileName, label = 'AI-aligned JSON' }: {
  value: unknown;
  fileName: string;
  label?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const json = open ? JSON.stringify(value, null, 2) : '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      setNotice('JSON copied.');
    } catch {
      setNotice('Copy unavailable. Select the JSON below or download the file.');
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName.replace(/\.pdf$/i, '')}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="sorye-json-document">
      <button type="button" aria-expanded={open} aria-controls={id}
        onClick={() => { setOpen(!open); setNotice(''); }}>
        {open ? 'Hide' : 'Show'} {label}
      </button>
      <div id={id} hidden={!open}>
        {open ? <>
          <div className="sorye-json-actions">
            <span>Complete document · JSON</span>
            <button type="button" onClick={() => void copy()}>Copy JSON</button>
            <button type="button" onClick={download}>Download JSON</button>
          </div>
          <p role="status">{notice}</p>
          <pre tabIndex={0} aria-label={label}><code>{json}</code></pre>
        </> : null}
      </div>
    </div>
  );
}

/** Keep every source line and its whitespace; page boundaries aid long-document reading. */
export function DocumentTranscript({ pages }: { pages: Array<{ page: number; rows: string[] }> }) {
  return (
    <div className="sorye-transcript">
      {pages.length === 0 ? <p>No transcript available.</p> : null}
      {pages.map((page) => (
        <section className="sorye-transcript-page" key={page.page} aria-label={`Transcript page ${page.page}`}>
          <header><strong>Page {page.page}</strong><span>{page.rows.length} lines</span></header>
          {page.rows.length ? <ol>
            {page.rows.map((row, index) => <li key={index}>{row || '\u00a0'}</li>)}
          </ol> : <p>No extracted text on this page.</p>}
        </section>
      ))}
    </div>
  );
}
