import type { OcrAnalysis } from '@sorye/types';
import {
  alignRecordsToRows,
  ocrReadingText,
  recordColumnLabel,
  recordTableColumns,
} from '@sorye/types';
import { hubApiPath } from './hub-origin';

export function ReadingView({ analysis }: { analysis: OcrAnalysis }) {
  const pattern = analysis.pattern;
  const records = alignRecordsToRows(pattern?.records ?? [], analysis.pages ?? []);
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
      {summary ? <p className="ocr-reading-summary">{summary}</p> : null}
      {analysis.error ? <p className="ocr-error">{analysis.error}</p> : null}

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
          <div className="ocr-reading-table-wrap">
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
        {analysis.pages.map((page) => (
          <div key={page.page}>
            <h4>Page {page.page}</h4>
            {page.rows.map((row, index) => (
              <p key={index}>{ocrReadingText(row) || row}</p>
            ))}
          </div>
        ))}
      </section>
    </article>
  );
}
