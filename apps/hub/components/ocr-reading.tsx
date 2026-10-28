import { JsonDocument } from '@sorye/sdk/react/document-reading';
import type { OcrAnalysis } from '@sorye/types';
import { buildOcrReadingDocument } from '@sorye/types';
import { PrintReadingButton } from './ocr-reading-print';

export function OcrReading({ analysis }: { analysis: OcrAnalysis }) {
  const pattern = analysis.pattern;
  const document = buildOcrReadingDocument(analysis);
  const kind = pattern?.documentKind?.trim() || 'Document';
  const warnings = analysis.vector?.notes?.filter((note) => note.warning) ?? [];
  const normalizedRows = document.normalizedData.rows;

  return (
    <div className="reading-root">
      <article className="reading">
        <header className="reading-toolbar">
          <a href="/apps/ocr">Back to OCR</a>
          <PrintReadingButton />
        </header>
        <p className="reading-kicker">
          {kind}
          {analysis.status === 'ready' ? '' : ' · normalization incomplete'}
        </p>
        <h1>{analysis.fileName}</h1>
        <p className="reading-meta">PDF type: {document.pdfTypeId ?? 'Not identified'} · {normalizedRows.length} data rows</p>
        <p className="reading-meta">Stored ID: {document.id}</p>
        {analysis.error ? <p className="reading-warning">{analysis.error}</p> : null}
        {warnings.length > 0 ? (
          <ul className="reading-warnings">
            {warnings.map((note) => <li key={note.page}>{note.warning}</li>)}
          </ul>
        ) : null}

        <section aria-labelledby="normalized-data-title">
          <h2 id="normalized-data-title">Normalized data</h2>
          {normalizedRows.length > 0 ? (
            <div className="reading-table-wrap" tabIndex={0} role="region" aria-label="Complete AI-normalized PDF data table">
              <table>
                <thead><tr>
                  {document.normalizedData.columns.map((column) => (
                    <th key={column} scope="col">{column}</th>
                  ))}
                </tr></thead>
                <tbody>{normalizedRows.map((row) => (
                  <tr key={`${row.page}:${row.row}`} className={row.id ? 'reading-position-row' : undefined}>
                    {row.cells.map((cell, index) => <td key={index}>{cell || '-'}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p>No extracted rows are available.</p>}
        </section>

        <section aria-labelledby="unclear-findings-title">
          <h2 id="unclear-findings-title">Unclear findings</h2>
          {pattern?.unclearFindings?.length ? (
            <ul className="reading-list">
              {pattern.unclearFindings.map((item, index) => (
                <li key={`${item.page}:${index}`}><strong>Page {item.page}:</strong> {item.finding}</li>
              ))}
            </ul>
          ) : <p>No unclear values were reported.</p>}
        </section>

        <JsonDocument value={document} fileName={analysis.fileName} label="Normalized JSON" />
      </article>
    </div>
  );
}
