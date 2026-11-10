'use client';

import { useId } from 'react';
import type { AdminLoadState } from './use-admin-json';

export type Tone = 'ok' | 'warn' | 'bad' | 'info';

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className="admin-badge" data-tone={tone}>{children}</span>;
}

/** Distinct loading, forbidden and unavailable states; renders nothing when ready. */
export function LoadNotice<T>({ state, what }: { state: AdminLoadState<T>; what: string }) {
  if (state.kind === 'loading') return <p role="status" className="admin-muted">Loading {what}.</p>;
  if (state.kind === 'forbidden') {
    return <p role="alert" className="admin-alert" data-tone="bad">Your session is no longer authorized for {what}. Sign in again with a platform administrator account.</p>;
  }
  if (state.kind === 'unavailable') {
    return (
      <p role="alert" className="admin-alert" data-tone="warn">
        {what[0]?.toUpperCase()}{what.slice(1)} is unavailable right now ({state.code}). Other sections keep working.
      </p>
    );
  }
  return null;
}

export function PageHeader({ title, intro }: { title: string; intro: string }) {
  return (
    <header>
      <h1>{title}</h1>
      <p className="admin-lede">{intro}</p>
    </header>
  );
}

export interface Column<Row> {
  header: string;
  cell: (row: Row) => React.ReactNode;
}

/** Responsive table: scroll region on wide screens, labelled cards in narrow containers. */
export function AdminTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
}: {
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  empty: string;
}) {
  const captionId = useId();
  if (rows.length === 0) return <p className="admin-muted">{empty}</p>;
  return (
    <div className="admin-scroll" tabIndex={0} role="region" aria-labelledby={captionId}>
      <table className="admin-table">
        <caption id={captionId}>{caption}</caption>
        <thead>
          <tr>{columns.map((column) => <th key={column.header} scope="col">{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column, index) => index === 0
                ? <th key={column.header} scope="row">{column.cell(row)}</th>
                : <td key={column.header} data-label={column.header}>{column.cell(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
