import { useEffect, useState, type FormEvent } from 'react';
import {
  ocrReadingText,
  recordColumnLabel,
  recordTableColumns,
  type OcrAmountOp,
  type OcrLibraryHit,
  type OcrLibraryQuery,
} from '@sorye/types';
import { hubApiPath } from './hub-origin';

const OPS: Array<{ id: OcrAmountOp; label: string }> = [
  { id: 'gt', label: 'greater than' },
  { id: 'gte', label: 'at least' },
  { id: 'lt', label: 'less than' },
  { id: 'lte', label: 'at most' },
  { id: 'eq', label: 'equal to' },
];

async function searchLibrary(query: OcrLibraryQuery): Promise<OcrLibraryHit[]> {
  const res = await fetch(hubApiPath('/api/ocr/analyses/query'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; hits?: OcrLibraryHit[] };
  if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);
  return data.hits ?? [];
}

export function LibraryPanel() {
  const [hits, setHits] = useState<OcrLibraryHit[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [notations, setNotations] = useState('');
  const [amountKey, setAmountKey] = useState('');
  const [amountOp, setAmountOp] = useState<OcrAmountOp>('gt');
  const [amountValue, setAmountValue] = useState('');
  const [scope, setScope] = useState<'document' | 'fields'>('document');
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(query: OcrLibraryQuery) {
    setBusy(true);
    setError(null);
    try {
      const next = await searchLibrary(query);
      setHits(next);
      setNames(Object.fromEntries(next.map((hit) => [hit.id, hit.fileName])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void run({});
  }, []);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    if (selectedOnly && selected.length === 0) {
      setError('Select at least one stored table.');
      return;
    }
    const query: OcrLibraryQuery = { scope };
    if (from) query.from = from;
    if (to) query.to = to;
    if (name.trim()) query.name = name.trim();
    if (code.trim()) query.code = code.trim();
    const keys = notations.split(',').map((item) => item.trim()).filter(Boolean);
    if (keys.length > 0) query.notations = keys;
    if (amountKey.trim() && amountValue.trim()) {
      query.amounts = [{ notation: amountKey.trim(), op: amountOp, value: Number(amountValue) }];
    }
    if (selectedOnly) query.ids = selected;
    await run(query);
  }

  async function rename(id: string) {
    const fileName = names[id]?.trim();
    if (!fileName) return;
    setError(null);
    const res = await fetch(hubApiPath(`/api/ocr/analyses/${id}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error || 'Could not rename this table');
      return;
    }
    setHits((current) => current.map((hit) => (hit.id === id ? { ...hit, fileName } : hit)));
  }

  return (
    <section className="ocr-library" aria-label="Stored tables">
      <header className="ocr-library-head">
        <div>
          <h2>Stored tables</h2>
          <p>
            The latest 50 PDF extractions. Dates are UTC days. A code or a field name looks
            inside the saved JSON, not the page transcript.
          </p>
        </div>
      </header>
      <form className="ocr-library-form" onSubmit={(event) => void onSearch(event)}>
        <label>
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="invoice" />
        </label>
        <label>
          Code
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="26-00168" />
        </label>
        <label>
          Field names
          <input
            value={notations}
            onChange={(event) => setNotations(event.target.value)}
            placeholder="amount, fields.Total"
          />
        </label>
        <label>
          Amount field
          <input value={amountKey} onChange={(event) => setAmountKey(event.target.value)} placeholder="amount" />
        </label>
        <label>
          Comparison
          <select value={amountOp} onChange={(event) => setAmountOp(event.target.value as OcrAmountOp)}>
            {OPS.map((op) => (
              <option key={op.id} value={op.id}>
                {op.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount
          <input
            inputMode="decimal"
            value={amountValue}
            onChange={(event) => setAmountValue(event.target.value)}
            placeholder="50000"
          />
        </label>
        <label>
          Keep
          <select value={scope} onChange={(event) => setScope(event.target.value as 'document' | 'fields')}>
            <option value="document">whole documents</option>
            <option value="fields">matching fields only</option>
          </select>
        </label>
        <label className="ocr-library-check">
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(event) => setSelectedOnly(event.target.checked)}
          />
          Selected only
        </label>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Searching…' : 'Search tables'}
        </button>
      </form>
      {error ? <p className="ocr-error">{error}</p> : null}
      {hits.length === 0 && !busy ? <p className="ocr-muted">No stored tables match this search.</p> : null}
      <div className="ocr-library-results">
        {hits.map((hit) => {
          const columns = recordTableColumns(hit.records);
          return (
            <article key={hit.id} className="ocr-library-card">
              <header>
                <label className="ocr-library-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(hit.id)}
                    onChange={() => toggle(hit.id)}
                  />
                  <span>{hit.documentKind}</span>
                </label>
                <time dateTime={hit.createdAt}>{hit.createdAt.slice(0, 10)}</time>
              </header>
              <div className="ocr-library-name">
                <input
                  aria-label={`Name for ${hit.fileName}`}
                  value={names[hit.id] ?? hit.fileName}
                  onChange={(event) => setNames((current) => ({ ...current, [hit.id]: event.target.value }))}
                />
                <button type="button" className="btn-ghost" onClick={() => void rename(hit.id)}>
                  Save name
                </button>
              </div>
              {Object.keys(hit.fields).length > 0 ? (
                <dl className="ocr-library-fields">
                  {Object.entries(hit.fields).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{ocrReadingText(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {columns.length > 0 ? (
                <div className="ocr-library-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {columns.map((column) => {
                          const label = recordColumnLabel(column);
                          return (
                            <th
                              key={column}
                              scope="col"
                              aria-label={label || `Column ${Number(column.slice(1)) + 1}`}
                            >
                              {label || '\u00a0'}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {hit.records.map((record, index) => (
                        <tr key={index}>
                          {columns.map((column) => (
                            <td key={column}>{ocrReadingText(record[column] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {hit.recordCount > hit.records.length ? (
                <p className="ocr-muted">Showing {hit.records.length} of {hit.recordCount} rows.</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
