import { JsonDocument } from '@sorye/sdk/react/document-reading';
import type { OcrAnalysis } from '@sorye/types';
import { buildOcrReadingDocument } from '@sorye/types';
import { hubApiPath } from './hub-origin';

export function ReadingView({ analysis }: { analysis: OcrAnalysis }) {
  const pattern = analysis.pattern;
  const document = buildOcrReadingDocument(analysis);
  const pageUrl = hubApiPath(`/apps/ocr/reading/${analysis.id}`);
  const kind = pattern?.documentKind?.trim() || 'Document';
  const normalizedRows = document.normalizedData.rows;

  return (
    <article className="ocr-reading" aria-label="LLM reading">
      <header className="ocr-reading-head">
        <div>
          <p className="ocr-reading-kicker">
            {kind}
            {analysis.status === 'ready' ? '' : ' · normalization incomplete'}
          </p>
          <h2>{analysis.fileName}</h2>
        </div>
        <a className="btn-ghost ocr-reading-open" href={pageUrl} target="_blank" rel="noopener">
          Open page
        </a>
      </header>
      <p className="ocr-reading-meta">PDF type: {document.pdfTypeId ?? 'Not identified'} · {normalizedRows.length} data rows</p>
      <p className="ocr-reading-meta">Stored ID: {document.id}</p>
      {analysis.error ? <p className="ocr-error">{analysis.error}</p> : null}

      <section aria-labelledby={`normalized-table-${analysis.id}`}>
        <h3 id={`normalized-table-${analysis.id}`}>Normalized data</h3>
        {normalizedRows.length > 0 ? (
          <div className="ocr-reading-table-wrap" tabIndex={0} role="region" aria-label="Complete AI-normalized PDF data table">
            <table>
              <thead><tr>
                {document.normalizedData.columns.map((column) => (
                  <th scope="col" key={column}>{column}</th>
                ))}
              </tr></thead>
              <tbody>{normalizedRows.map((row) => (
                <tr key={`${row.page}:${row.row}`} className={row.id ? 'ocr-position-row' : undefined}>
                  {row.cells.map((cell, index) => <td key={index}>{cell || '-'}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p>No extracted rows are available.</p>}
      </section>

      <section className="ocr-findings" aria-labelledby={`unclear-${analysis.id}`}>
        <h3 id={`unclear-${analysis.id}`}>Unclear findings</h3>
        {pattern?.unclearFindings?.length ? (
          <ul>{pattern.unclearFindings.map((item, index) => (
            <li key={`${item.page}:${index}`}><strong>Page {item.page}:</strong> {item.finding}</li>
          ))}</ul>
        ) : <p>No unclear values were reported.</p>}
      </section>

      <JsonDocument value={document} fileName={analysis.fileName} label="Normalized JSON" />
    </article>
  );
}
