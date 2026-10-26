import { DocumentTranscript, JsonDocument } from '@sorye/sdk/react/document-reading';
import type { OcrAnalysis } from '@sorye/types';
import {
  buildOcrReadingDocument,
  ocrReadingText,
  recordColumnLabel,
  recordTableColumns,
} from '@sorye/types';
import { hubApiPath } from './hub-origin';

export function ReadingView({ analysis }: { analysis: OcrAnalysis }) {
  const pattern = analysis.pattern;
  const document = buildOcrReadingDocument(analysis);
  const records = document.records;
  const columns = recordTableColumns(records);
  const pageUrl = hubApiPath(`/apps/ocr/reading/${analysis.id}`);
  const kind = pattern?.documentKind?.trim() || 'Document';
  const summary = ocrReadingText(pattern?.summary ?? '');

  return (
    <article className="ocr-reading" aria-label="Qwen reading">
      <header className="ocr-reading-head">
        <div>
          <p className="ocr-reading-kicker">
            {kind}
            {analysis.status === 'ready' ? '' : ' · pattern incomplete'}
          </p>
          <h2>{analysis.fileName}</h2>
        </div>
        <a className="btn-ghost ocr-reading-open" href={pageUrl} target="_blank" rel="noopener">
          Open page
        </a>
      </header>
      <p className="ocr-reading-meta">{analysis.pages.length} pages · {analysis.pages.reduce((total, page) => total + page.rows.length, 0)} transcript lines · {records.length} records</p>
      {summary ? <p className="ocr-reading-summary">{summary}</p> : null}
      {analysis.error ? <p className="ocr-error">{analysis.error}</p> : null}

      <JsonDocument value={document} fileName={analysis.fileName} />

      {pattern && Object.keys(pattern.fields).length > 0 ? (
        <section>
          <h3>Fields</h3>
          <dl className="ocr-reading-fields">
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
          <h3>Records</h3>
          <div className="ocr-reading-table-wrap" tabIndex={0} role="region" aria-label="Document records">
            <table>
              <caption className="ocr-sr-only">Document records aligned to the extracted rows</caption>
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

      <section className="ocr-reading-transcript">
        <h3>Transcript</h3>
        <p className="ocr-transcript-note">The complete extracted text, in page order. Line numbers restart on each page.</p>
        <DocumentTranscript pages={analysis.pages} />
      </section>
    </article>
  );
}
