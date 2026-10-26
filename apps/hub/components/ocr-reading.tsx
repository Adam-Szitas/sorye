import { DocumentTranscript, JsonDocument } from '@sorye/sdk/react/document-reading';
import type { OcrAnalysis } from '@sorye/types';
import {
  buildOcrReadingDocument,
  ocrReadingText,
  recordColumnLabel,
  recordTableColumns,
} from '@sorye/types';
import { PrintReadingButton } from './ocr-reading-print';

export function OcrReading({ analysis }: { analysis: OcrAnalysis }) {
  const pattern = analysis.pattern;
  const document = buildOcrReadingDocument(analysis);
  const records = document.records;
  const columns = recordTableColumns(records);
  const kind = pattern?.documentKind?.trim() || 'Document';
  const summary = ocrReadingText(pattern?.summary ?? '');
  const warnings = analysis.vector?.notes?.filter((note) => note.warning) ?? [];

  return (
    <div className="reading-root">
      <article className="reading">
        <header className="reading-toolbar">
          <a href="/apps/ocr">Back to OCR</a>
          <PrintReadingButton />
        </header>
        <p className="reading-kicker">
          {kind}
          {analysis.status === 'ready' ? '' : ' · pattern incomplete'}
        </p>
        <h1>{analysis.fileName}</h1>
        <p className="reading-meta">
          {analysis.pages.length} pages · {analysis.lines.length} transcript lines · {records.length} records
        </p>
        {summary ? <p className="reading-summary">{summary}</p> : null}
        {analysis.error ? <p className="reading-warning">{analysis.error}</p> : null}
        {warnings.length > 0 ? (
          <ul className="reading-warnings">
            {warnings.map((note) => (
              <li key={note.page}>{note.warning}</li>
            ))}
          </ul>
        ) : null}

        <JsonDocument value={document} fileName={analysis.fileName} />

        {pattern && Object.keys(pattern.fields).length > 0 ? (
          <section>
            <h2>Fields</h2>
            <dl className="reading-fields">
              {Object.entries(pattern.fields).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{ocrReadingText(value) || value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {records.length > 0 && columns.length > 0 ? (
          <section>
            <h2>Records</h2>
            <div className="reading-table-wrap" tabIndex={0} role="region" aria-label="Document records">
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
                          {label || `Column ${Number(column.slice(1)) + 1}`}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {records.map((record, index) => (
                    <tr key={index}>
                      {columns.map((column) => (
                        <td key={column}>{ocrReadingText(record[column] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {pattern && pattern.patterns.length > 0 ? (
          <section>
            <h2>Patterns</h2>
            <ul className="reading-list">
              {pattern.patterns.map((hit, index) => (
                <li key={`${hit.name}-${index}`}>
                  <strong>{hit.name}</strong>
                  {hit.description ? ` — ${ocrReadingText(hit.description)}` : ''}
                  <span className="reading-meta"> page {hit.page}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {pattern && pattern.math.length > 0 ? (
          <section>
            <h2>Math</h2>
            <ul className="reading-list">
              {pattern.math.map((item, index) => (
                <li key={`${item.page}-${item.row}-${index}`}>
                  {ocrReadingText(item.text) || item.text}
                  <span className="reading-meta">
                    {' '}
                    page {item.page}, row {item.row}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="reading-transcript">
          <h2>Transcript</h2>
          <p className="reading-meta">The complete extracted text, in page order. Line numbers restart on each page.</p>
          <DocumentTranscript pages={analysis.pages} />
        </section>
      </article>
    </div>
  );
}
