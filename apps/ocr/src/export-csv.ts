import type { OcrPageLayout } from '@sorye/types';

function csvEscape(value: string): string {
  const trimmed = value.replace(/\r?\n/g, ' ').trim();
  if (/[",;]/.test(trimmed)) return `"${trimmed.replace(/"/g, '""')}"`;
  return trimmed;
}

/** Excel-friendly CSV (semicolon, UTF-8 BOM) from evaluated layout matrices. */
export function layoutsToCsv(layouts: OcrPageLayout[]): string {
  const lines: string[] = [];

  layouts.forEach((layout, index) => {
    if (layouts.length > 1) {
      if (index > 0) lines.push('');
      lines.push(csvEscape(`Page ${index + 1}`));
    }

    for (const row of layout.rows) {
      const cells = row.cells.map((cell) => cell.text.trim());
      if (!cells.some(Boolean)) continue;
      let last = cells.length - 1;
      while (last >= 0 && !cells[last]) last -= 1;
      lines.push(cells.slice(0, last + 1).map(csvEscape).join(';'));
    }
  });

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
