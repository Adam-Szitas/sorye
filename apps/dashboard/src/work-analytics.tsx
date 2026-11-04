import { useEffect, useState } from 'react';
import type {
  AnalyticsAppSection,
  AnalyticsOcrJob,
  WorkspaceAnalyticsSnapshot,
} from '@sorye/types';

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes} min ${rem} s`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusLabel(status: AnalyticsOcrJob['status']): string {
  return status === 'ready' ? 'Ready' : 'Rows only';
}

function isSnapshot(value: unknown): value is WorkspaceAnalyticsSnapshot {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as WorkspaceAnalyticsSnapshot).sections));
}

function OcrSection({ section }: { section: Extract<AnalyticsAppSection, { kind: 'ocr' }> }) {
  const gpuHint = section.timedCount === 0
    ? 'Model time was not stored for these analyses.'
    : section.timedCount === section.count
      ? 'Model time from the first model request to finish.'
      : `Model time on ${section.timedCount} of ${section.count} analyses.`;

  return (
    <section className="work-section" aria-labelledby="work-ocr-heading">
      <h2 id="work-ocr-heading">OCR</h2>
      <p className="work-kicker">Finished analyses for this workspace.</p>
      <div className="metrics-grid">
        <article className="metric-card">
          <span className="metric-label">Analyses</span>
          <strong className="metric-value">{section.count}</strong>
          <span className="metric-hint">Ready and rows-only</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Model time</span>
          <strong className="metric-value">{formatDuration(section.totalDurationMs)}</strong>
          <span className="metric-hint">{gpuHint}</span>
        </article>
      </div>
    </section>
  );
}

function OcrJobs({ section }: { section: Extract<AnalyticsAppSection, { kind: 'ocr' }> }) {
  return (
    <section className="work-section" aria-labelledby="work-ocr-jobs-heading">
      <h2 id="work-ocr-jobs-heading">OCR recent jobs</h2>
      {section.count > section.jobs.length ? (
        <p className="work-kicker">Showing the {section.jobs.length} most recent of {section.count}.</p>
      ) : (
        <p className="work-kicker">Each row is one finished OCR analysis.</p>
      )}
      <div className="work-table-wrap">
        <table className="work-table">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Status</th>
              <th scope="col">Pages</th>
              <th scope="col">Rows</th>
              <th scope="col">Model time</th>
              <th scope="col">Saved</th>
              <th scope="col">Finished</th>
            </tr>
          </thead>
          <tbody>
            {section.jobs.map((job) => (
              <tr key={job.id}>
                <td className="work-file">{job.fileName}</td>
                <td>
                  <span className={`status-pill status-${job.status}`}>{statusLabel(job.status)}</span>
                </td>
                <td className="work-num">{job.pageCount}</td>
                <td className="work-num">{job.rowCount}</td>
                <td className="work-num">{formatDuration(job.durationMs)}</td>
                <td className="work-num">{formatWhen(job.createdAt)}</td>
                <td className="work-num">{formatWhen(job.workFinishedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventSection({ section }: { section: Extract<AnalyticsAppSection, { kind: 'events' }> }) {
  const headingId = `work-app-${section.appId}`;
  return (
    <section className="work-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{section.appName}</h2>
      <div className="metrics-grid">
        <article className="metric-card">
          <span className="metric-label">Events</span>
          <strong className="metric-value">{section.count}</strong>
          <span className="metric-hint">Recorded workspace events</span>
        </article>
      </div>
    </section>
  );
}

export function WorkAnalytics() {
  const [snapshot, setSnapshot] = useState<WorkspaceAnalyticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/analytics', { credentials: 'include' });
        if (!res.ok) {
          throw new Error(res.status === 401 ? 'Sign in to see workspace work.' : 'Could not load work analytics.');
        }
        const body: unknown = await res.json();
        if (!isSnapshot(body)) throw new Error('Could not load work analytics.');
        if (!cancelled) setSnapshot(body);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load work analytics.');
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <div className="dashboard-state dashboard-error">{error}</div>;
  }
  if (!snapshot) {
    return <div className="dashboard-state">Loading work by app…</div>;
  }

  const sections = snapshot.sections.filter((section) =>
    section.kind === 'ocr'
      ? section.count > 0 && Array.isArray(section.jobs)
      : section.kind === 'events' && section.count > 0,
  );

  if (sections.length === 0) {
    return (
      <section className="panel" aria-labelledby="work-empty-heading">
        <h2 id="work-empty-heading">Work by app</h2>
        <p className="panel-empty">No finished work is stored for this workspace yet.</p>
      </section>
    );
  }

  const ocr = sections.find((section): section is Extract<AnalyticsAppSection, { kind: 'ocr' }> => section.kind === 'ocr');

  return (
    <div className="work-analytics">
      {sections.map((section) =>
        section.kind === 'ocr'
          ? <OcrSection key={section.appId} section={section} />
          : <EventSection key={section.appId} section={section} />,
      )}
      {ocr ? <OcrJobs section={ocr} /> : null}
    </div>
  );
}
