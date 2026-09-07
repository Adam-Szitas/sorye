'use client';

import {
  REPORT_RANGE_DAYS,
  type ReportNamedCount,
  type ReportRangeDays,
  type ReportSeriesPoint,
  type WorkspaceReportsSnapshot,
} from '@sorye/types';
import { useCallback, useEffect, useId, useState } from 'react';

function formatBucket(bucket: string, granularity: 'day' | 'week'): string {
  if (granularity === 'week') return bucket;
  const date = new Date(`${bucket}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return bucket;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function BarSeries({
  points,
  granularity,
  caption,
}: {
  points: ReportSeriesPoint[];
  granularity: 'day' | 'week';
  caption: string;
}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const chartId = useId();
  const width = 1000;
  const height = 180;
  const pad = { top: 12, right: 8, bottom: 36, left: 32 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const gap = points.length > 1 ? innerW / points.length : innerW;
  const barW = Math.max(3, gap * 0.62);

  return (
    <figure className="min-w-0 w-full">
      <svg
        role="img"
        aria-labelledby={chartId}
        viewBox={`0 0 ${width} ${height}`}
        className="block h-48 w-full"
        preserveAspectRatio="none"
      >
        <title id={chartId}>{caption}</title>
        {[0, 0.5, 1].map((t) => {
          const y = pad.top + innerH * (1 - t);
          return (
            <g key={t}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.08)"
              />
              <text
                x={pad.left - 6}
                y={y + 3}
                textAnchor="end"
                fill="#94a3b8"
                fontSize="9"
              >
                {Math.round(max * t)}
              </text>
            </g>
          );
        })}
        {points.map((point, i) => {
          const h = (point.count / max) * innerH;
          const x = pad.left + gap * i + (gap - barW) / 2;
          const y = pad.top + innerH - h;
          const label = formatBucket(point.bucket, granularity);
          const showLabel =
            points.length <= 14 || i % Math.ceil(points.length / 8) === 0;
          return (
            <g key={point.bucket}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, point.count > 0 ? 2 : 0)}
                rx="2"
                fill="#818cf8"
              >
                <title>
                  {label}: {point.count}
                </title>
              </rect>
              {showLabel ? (
                <text
                  x={x + barW / 2}
                  y={height - 12}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="8"
                >
                  {label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function BreakdownList({
  items,
  empty,
}: {
  items: ReportNamedCount[];
  empty: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  if (items.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">{empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <div className="mb-0.5 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-[var(--color-text)]">{item.label}</span>
            <span className="shrink-0 tabular-nums text-[var(--color-text-muted)]">
              {item.count}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-white/8"
            role="meter"
            aria-label={item.label}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={item.count}
          >
            <div
              className="h-full rounded-full bg-[var(--color-accent)] motion-reduce:transition-none"
              style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function FunnelChart({ items }: { items: ReportNamedCount[] }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <ol className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3">
          <span className="w-36 shrink-0 text-xs text-[var(--color-text-muted)]">
            {item.label}
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="h-7 overflow-hidden rounded-md bg-white/8"
              role="meter"
              aria-label={item.label}
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={item.count}
            >
              <div
                className="flex h-full items-center rounded-md bg-indigo-400/80 px-2 text-[11px] font-medium text-white motion-reduce:transition-none"
                style={{
                  width: `${Math.max(item.count > 0 ? 12 : 0, (item.count / max) * 100)}%`,
                }}
              >
                {item.count > 0 ? item.count : ''}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function AppReports() {
  const [days, setDays] = useState<ReportRangeDays>(14);
  const [data, setData] = useState<WorkspaceReportsSnapshot | null>(null);
  const [error, setError] = useState<'forbidden' | 'load' | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (range: ReportRangeDays) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports?days=${range}`, {
        credentials: 'include',
      });
      if (res.status === 401 || res.status === 403) {
        setData(null);
        setError('forbidden');
        return;
      }
      if (!res.ok) {
        setData(null);
        setError('load');
        return;
      }
      setData((await res.json()) as WorkspaceReportsSnapshot);
    } catch {
      setData(null);
      setError('load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const empty = data !== null && data.totals.events === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="mt-1 max-w-xl text-sm text-[var(--color-text-muted)]">
            Operational counts for this workspace. Charts use allowlisted event
            names, app ids, and day buckets — never message bodies or file
            contents.
          </p>
        </div>
        <div
          className="flex rounded-xl bg-white/8 p-1"
          role="radiogroup"
          aria-label="Report range"
        >
          {REPORT_RANGE_DAYS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={days === value}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                days === value
                  ? 'bg-white/15 text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
              onClick={() => setDays(value)}
            >
              {value}d
            </button>
          ))}
        </div>
      </header>

      {error === 'forbidden' ? (
        <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-[var(--color-text-muted)]">
          Reports is limited to workspace admins.
        </p>
      ) : null}

      {error === 'load' ? (
        <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-[var(--color-text-muted)]">
          Could not load reports. Try again in a moment.
        </p>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading charts…</p>
      ) : null}

      {data && error === null ? (
        <div className="@container grid gap-4">
          {data.eventsEnabled ? null : (
            <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              App events are off in Dashboard. Hub still counts accepted emits
              for this workspace.
            </p>
          )}

          <section className="grid gap-3 sm:grid-cols-3">
            <article className="surface rounded-2xl p-4">
              <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                Events
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {data.totals.events}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Last {data.rangeDays} days
              </p>
            </article>
            <article className="surface rounded-2xl p-4">
              <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                Studio too-much
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {data.totals.tooMuch}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                GPU path shut down
              </p>
            </article>
            <article className="surface rounded-2xl p-4">
              <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                Failed deliveries
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {data.totals.failedDeliveries}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Relay failures in this workspace
              </p>
            </article>
          </section>

          {empty ? (
            <section className="surface rounded-2xl p-8 text-center">
              <h2 className="text-lg font-medium">No events in this range</h2>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                Counts start when apps post allowlisted events to Hub. Open OCR,
                Protocolio, Studio, or Tasks after App events are on to see
                volume here.
              </p>
            </section>
          ) : (
            <>
              <section className="surface rounded-2xl p-4">
                <h2 className="mb-2 text-sm font-medium">
                  Event volume ({data.granularity === 'week' ? 'week' : 'day'})
                </h2>
                <BarSeries
                  points={data.series}
                  granularity={data.granularity}
                  caption={`Event volume over the last ${data.rangeDays} days`}
                />
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <article className="surface rounded-2xl p-4">
                  <h2 className="mb-3 text-sm font-medium">By app</h2>
                  <BreakdownList
                    items={data.byApp}
                    empty="No app-attributed events yet."
                  />
                </article>
                <article className="surface rounded-2xl p-4">
                  <h2 className="mb-3 text-sm font-medium">By event</h2>
                  <BreakdownList
                    items={data.byName}
                    empty="No allowlisted events yet."
                  />
                </article>
              </section>

              <section className="surface rounded-2xl p-4">
                <h2 className="mb-3 text-sm font-medium">Ops funnel</h2>
                <p className="mb-4 text-xs text-[var(--color-text-muted)]">
                  Existing Hub events only — OCR ready, Protocolio generated,
                  Studio loaded / too-much, tasks, calendar, notes.
                </p>
                <FunnelChart items={data.funnel} />
              </section>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
