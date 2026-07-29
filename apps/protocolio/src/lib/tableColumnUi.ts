import type { TableColumn } from '@protocolio/sdk';

export function columnBorderClass(col: TableColumn | undefined, base = ''): string {
  const classes = base ? [base] : [];
  if (col?.borderHorizontal === false) classes.push('table-col-no-h-border');
  return classes.join(' ');
}
