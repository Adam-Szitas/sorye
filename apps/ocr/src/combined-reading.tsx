import { normalizeOcrMatrixId, type OcrAnalysis, type OcrMatrixRow } from '@sorye/types';

export type ComparisonAnalysis = Pick<OcrAnalysis, 'id' | 'fileName' | 'status' | 'pattern' | 'error'>;

export interface ComparisonDocument {
  analysis: ComparisonAnalysis;
  selected: boolean;
}

function rowsForDocument(analysis: ComparisonAnalysis): OcrMatrixRow[] {
  return analysis.pattern?.matrixRows ?? [];
}

export function CombinedReading({
  documents,
  onToggle,
}: {
  documents: ComparisonDocument[];
  onToggle: (analysisId: string) => void;
}) {
  const selected = documents.filter((document) => document.selected);
  const merged = new Map<string, {
    id: string;
    sources: Map<string, OcrMatrixRow[]>;
  }>();

  for (const document of selected) {
    for (const row of rowsForDocument(document.analysis)) {
      const key = normalizeOcrMatrixId(row.id);
      const entry = merged.get(key) ?? { id: row.id, sources: new Map() };
      const sourceRows = entry.sources.get(document.analysis.id) ?? [];
      sourceRows.push(row);
      entry.sources.set(document.analysis.id, sourceRows);
      merged.set(key, entry);
    }
  }

  const rows = [...merged.values()].sort((a, b) =>
    normalizeOcrMatrixId(a.id).localeCompare(normalizeOcrMatrixId(b.id), undefined, { numeric: true }),
  );
  const maxCells = Math.max(
    1,
    ...selected.flatMap((document) => rowsForDocument(document.analysis).map((row) => Math.max(1, row.cells.length - 1))),
  );
  const findings = selected.flatMap((document) =>
    (document.analysis.pattern?.unclearFindings ?? []).map((item) => ({
      ...item,
      fileName: document.analysis.fileName,
    })),
  );

  return (
    <section className="ocr-compare" aria-labelledby="ocr-compare-title">
      <header>
        <div>
          <h2 id="ocr-compare-title">Compare PDF matrices</h2>
          <p>Select analyzed PDFs to align rows by their address ID. Leading zeros, spaces, and the final dot group are normalized for matching.</p>
        </div>
      </header>

      <fieldset className="ocr-compare-files">
        <legend>Included PDFs</legend>
        {documents.length === 0 ? (
          <p className="ocr-muted">Analyze PDFs to add them here.</p>
        ) : documents.map(({ analysis, selected: checked }) => (
          <label key={analysis.id}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(analysis.id)}
            />
            <span>{analysis.fileName}</span>
            <small>{rowsForDocument(analysis).length} identified rows</small>
          </label>
        ))}
      </fieldset>

      {selected.length > 0 ? (
        <>
          <p className="ocr-reading-meta">
            {rows.length} distinct address IDs · {rows.filter((row) => row.sources.size > 1).length} matched across PDFs
          </p>
          {rows.length > 0 ? (
            <div className="ocr-reading-table-wrap" tabIndex={0} role="region" aria-label="Combined PDF matrix rows">
              <table>
                <caption className="ocr-sr-only">Rows aligned across selected PDFs by normalized address ID</caption>
                <thead>
                  <tr>
                    <th scope="col" rowSpan={2}>Address ID</th>
                    {selected.map(({ analysis }) => (
                      <th key={analysis.id} scope="colgroup" colSpan={maxCells}>
                        {analysis.fileName}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {selected.flatMap(({ analysis }) => Array.from({ length: maxCells }, (_, index) => (
                      <th key={`${analysis.id}:${index}`} scope="col">Value {index + 1}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={normalizeOcrMatrixId(row.id)}>
                      <th scope="row">{row.id}</th>
                      {selected.flatMap(({ analysis }) => {
                        const sourceRows = row.sources.get(analysis.id) ?? [];
                        return Array.from({ length: maxCells }, (_, index) => {
                          const value = sourceRows
                          .map((sourceRow) => sourceRow.cells[index + 1] ?? '')
                            .filter(Boolean)
                            .join(' · ');
                          return <td key={`${analysis.id}:${index}`}>{value}</td>;
                        });
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ocr-muted">Qwen has not identified address rows in the selected PDFs yet.</p>
          )}

          <section className="ocr-findings" aria-labelledby="ocr-findings-title">
            <h3 id="ocr-findings-title">Unclear findings by page</h3>
            {findings.length > 0 ? (
              <ul>{findings.map((item, index) => (
                <li key={`${item.fileName}:${item.page}:${index}`}>
                  <strong>{item.fileName}, page {item.page}:</strong> {item.finding}
                </li>
              ))}</ul>
            ) : <p>No unclear values were reported for the selected PDFs.</p>}
          </section>
        </>
      ) : null}
    </section>
  );
}
