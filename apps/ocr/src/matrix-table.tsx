/** Read-only HTML table from OCR matrix (header row when multiple rows). */

export function matrixHasContent(matrix: string[][]): boolean {
  return matrix.some((row) => row.some((cell) => cell.trim().length > 0));
}

interface MatrixHtmlTableProps {
  matrix: string[][];
  className?: string;
}

export function MatrixHtmlTable({ matrix, className }: MatrixHtmlTableProps) {
  if (!matrix.length || !matrixHasContent(matrix)) {
    return <p className="ocr-muted">No rows to display.</p>;
  }

  const cols = Math.max(...matrix.map((row) => row.length));
  const padRow = (row: string[]) =>
    Array.from({ length: cols }, (_, i) => row[i] ?? '');

  if (matrix.length > 1) {
    const [header, ...body] = matrix.map(padRow);
    return (
      <table className={className ?? 'ocr-formatted-table'}>
        <thead>
          <tr>
            {header.map((cell, c) => (
              <th key={`h-${c}`}>{cell.trim() || `Column ${c + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={`r-${r}`}>
              {row.map((cell, c) => (
                <td key={`c-${r}-${c}`}>{cell.trim() || '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const row = padRow(matrix[0] ?? []);
  return (
    <table className={className ?? 'ocr-formatted-table'}>
      <thead>
        <tr>
          {row.map((_, c) => (
            <th key={`h-${c}`}>Column {c + 1}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {row.map((cell, c) => (
            <td key={`c-0-${c}`}>{cell.trim() || '—'}</td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/** Serialize matrix as a standalone HTML table snippet. */
export function matrixToHtml(matrix: string[][]): string {
  if (!matrix.length || !matrixHasContent(matrix)) return '';

  const cols = Math.max(...matrix.map((row) => row.length));
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const padRow = (row: string[]) =>
    Array.from({ length: cols }, (_, i) => row[i] ?? '');

  if (matrix.length > 1) {
    const [header, ...body] = matrix.map(padRow);
    const th = header
      .map(
        (cell, c) =>
          `<th>${esc(cell.trim() || `Column ${c + 1}`)}</th>`,
      )
      .join('');
    const rows = body
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${esc(cell.trim() || '—')}</td>`).join('')}</tr>`,
      )
      .join('');
    return `<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  const row = padRow(matrix[0] ?? []);
  const th = row.map((_, c) => `<th>Column ${c + 1}</th>`).join('');
  const td = row.map((cell) => `<td>${esc(cell.trim() || '—')}</td>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody><tr>${td}</tr></tbody></table>`;
}
