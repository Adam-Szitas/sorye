'use client';

import {
  SUBSCRIPTION_PLANS,
  type OperatorDashboardSnapshot,
  type OperatorUsagePoint,
  type SubscriptionTierId,
} from '@sorye/types';
import { useCallback, useEffect, useId, useState, type CSSProperties, type FormEvent } from 'react';

const AUDIENCES = [
  { id: 'all', label: 'All signed-in users' },
  ...SUBSCRIPTION_PLANS.map((plan) => ({ id: plan.id, label: plan.name })),
] as const;

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBucket(bucket: string): string {
  if (bucket.includes('T')) return `${bucket.slice(5, 10)} ${bucket.slice(11, 13)}:00 UTC`;
  return bucket;
}

function DataTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: string[][];
}) {
  const captionId = useId();
  const style: CSSProperties = {};
  headers.forEach((header, index) => {
    (style as Record<string, string>)[`--label-${index + 1}`] = `"${header.replaceAll('"', '')}"`;
  });
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">Nothing in this list yet.</p>;
  }
  return (
    <div className="op-scroll" tabIndex={0} role="region" aria-labelledby={captionId}>
      <table className="op-table" style={style}>
        <caption id={captionId}>{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`}>
              {row.map((cell, cellIndex) => (
                cellIndex === 0
                  ? <th key={cellIndex} scope="row">{cell}</th>
                  : <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageChart({
  title,
  points,
}: {
  title: string;
  points: OperatorUsagePoint[];
}) {
  const titleId = useId();
  const max = Math.max(1, ...points.map((point) => point.opens + point.jobs + point.errors));
  return (
    <figure className="min-w-0">
      <figcaption id={titleId} className="mb-2 text-sm font-medium">{title}</figcaption>
      <svg viewBox="0 0 640 160" className="block h-40 w-full" aria-hidden="true">
        {points.map((point, index) => {
          const slot = 640 / Math.max(points.length, 1);
          const total = point.opens + point.jobs;
          const height = (total / max) * 110;
          const errorHeight = (point.errors / max) * 110;
          const x = slot * index + slot * 0.2;
          return (
            <g key={point.bucket}>
              <rect x={x} y={130 - height} width={slot * 0.6} height={Math.max(height, 0)} fill="#38bdf8" />
              <rect x={x} y={130 - errorHeight} width={slot * 0.6} height={Math.max(errorHeight, 0)} fill="#f87171" opacity="0.9" />
            </g>
          );
        })}
      </svg>
      <p className="mb-2 text-sm text-[var(--color-text-muted)]">
        Blue bars are opens and jobs. Red bars are errors. The table lists the same numbers.
      </p>
      <DataTable
        caption={`${title} numbers`}
        headers={['Time', 'Opens', 'Jobs', 'Errors', 'Active workspaces']}
        rows={points.map((point) => [
          formatBucket(point.bucket),
          String(point.opens),
          String(point.jobs),
          String(point.errors),
          String(point.activeWorkspaces),
        ])}
      />
    </figure>
  );
}

function healthWord(value: string): string {
  if (value === 'up') return 'Up';
  if (value === 'available') return 'Available';
  if (value === 'paused') return 'Paused';
  if (value === 'unconfigured') return 'Not configured';
  if (value === 'unknown') return 'Unknown';
  if (value === 'unavailable') return 'Unavailable';
  return 'Down';
}

export function AppOperator() {
  const [data, setData] = useState<OperatorDashboardSnapshot | null>(null);
  const [error, setError] = useState<'forbidden' | 'load' | null>(null);
  const [loading, setLoading] = useState(true);
  const [planStatus, setPlanStatus] = useState('');
  const [noticeStatus, setNoticeStatus] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const planFormId = useId();
  const noticeFormId = useId();
  const planHintId = `${planFormId}-hint`;
  const noticeHintId = `${noticeFormId}-hint`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/operator', { credentials: 'include', cache: 'no-store' });
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
      setData((await res.json()) as OperatorDashboardSnapshot);
    } catch {
      setData(null);
      setError('load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const body = new FormData(form);
    const effective = String(body.get('effectiveAt') ?? '');
    setPlanBusy(true);
    setPlanStatus('');
    try {
      const res = await fetch('/api/operator/plan', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: body.get('workspaceId'),
          subscriptionId: body.get('subscriptionId'),
          effectiveAt: effective ? new Date(effective).toISOString() : null,
          note: body.get('note') || null,
        }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string; applied?: boolean } | null;
      if (!res.ok) {
        setPlanStatus(payload?.error ?? 'Could not save the plan.');
        return;
      }
      setPlanStatus(payload?.applied ? 'Plan saved.' : 'Plan scheduled.');
      form.reset();
      await load();
    } catch {
      setPlanStatus('Could not save the plan.');
    } finally {
      setPlanBusy(false);
    }
  }

  async function saveNotice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const body = new FormData(form);
    const starts = String(body.get('startsAt') ?? '');
    const ends = String(body.get('endsAt') ?? '');
    setNoticeBusy(true);
    setNoticeStatus('');
    try {
      const res = await fetch('/api/operator/notices', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: body.get('message'),
          audience: body.get('audience'),
          startsAt: starts ? new Date(starts).toISOString() : null,
          endsAt: ends ? new Date(ends).toISOString() : null,
          active: body.get('active') === 'on',
        }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNoticeStatus(payload?.error ?? 'Could not publish the notice.');
        return;
      }
      setNoticeStatus('Notice saved.');
      form.reset();
      await load();
    } catch {
      setNoticeStatus('Could not publish the notice.');
    } finally {
      setNoticeBusy(false);
    }
  }

  async function setNoticeActive(id: string, active: boolean) {
    setNoticeStatus('');
    const res = await fetch('/api/operator/notices', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active }),
    });
    if (!res.ok) {
      setNoticeStatus('Could not update the notice.');
      return;
    }
    setNoticeStatus(active ? 'Notice activated.' : 'Notice turned off.');
    await load();
  }

  return (
    <div className="op-root flex flex-1 flex-col gap-8 overflow-auto p-6">
      <style>{`
        .op-root { content-visibility: visible; }
        .op-defer { content-visibility: auto; contain-intrinsic-size: auto 28rem; }
        .op-root :focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }
        .op-root input, .op-root select, .op-root textarea { font-size: 1rem; line-height: 1.4; }
        .op-root button, .op-root input, .op-root select, .op-root textarea {
          border: 1px solid var(--color-border);
          background: var(--color-surface-overlay);
          color: var(--color-text);
          border-radius: 0.75rem;
        }
        .op-root button { min-block-size: 3rem; padding-inline: 1rem; }
        .op-field { display: flex; flex-direction: column; gap: 0.35rem; margin-block-end: 1rem; }
        .op-scroll {
          overflow: auto;
          max-inline-size: 100%;
          max-block-size: min(28rem, 70vh);
          container-type: inline-size;
          border: 1px solid var(--color-border);
          border-radius: 0.75rem;
        }
        .op-table { border-collapse: separate; border-spacing: 0; inline-size: 100%; font-size: 0.875rem; }
        .op-table caption { text-align: start; font-weight: 600; padding: 0.75rem; }
        .op-table th, .op-table td { padding: 0.6rem 0.75rem; text-align: start; vertical-align: top; border-block-end: 1px solid var(--color-border); }
        .op-table thead { position: sticky; inset-block-start: 0; z-index: 1; background: var(--color-surface-raised); }
        .op-table tbody th { position: sticky; inset-inline-start: 0; background: var(--color-surface-raised); }
        @container (width < 40rem) {
          .op-table, .op-table thead, .op-table tbody, .op-table tr, .op-table th, .op-table td { display: block; }
          .op-table thead { display: none; }
          .op-table tr { margin-block-end: 0.75rem; border: 1px solid var(--color-border); }
          .op-table tbody th { position: sticky; inset-block-start: 0; z-index: 2; }
          .op-table td::before { content: var(--label, ""); font-weight: 600; }
          .op-table td:nth-child(2)::before { content: var(--label-2) ": "; }
          .op-table td:nth-child(3)::before { content: var(--label-3) ": "; }
          .op-table td:nth-child(4)::before { content: var(--label-4) ": "; }
          .op-table td:nth-child(5)::before { content: var(--label-5) ": "; }
          .op-table td:nth-child(6)::before { content: var(--label-6) ": "; }
        }
      `}</style>
      <header>
        <h1 className="text-2xl font-semibold">Operator</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
          Platform health, plans, and notices. Counts and names only — document text, prompts, and message bodies stay out of this view.
        </p>
        <nav className="mt-3 flex flex-wrap gap-3 text-sm" aria-label="Operator sections">
          <a href="#operator-health">Health</a>
          <a href="#operator-activity">Activity</a>
          <a href="#operator-usage">Usage</a>
          <a href="#operator-load">App load</a>
          <a href="#operator-errors">Errors</a>
          <a href="#operator-plans">Plans</a>
          <a href="#operator-notices">Notices</a>
        </nav>
      </header>

      {loading ? <p role="status">Loading operator data.</p> : null}
      {error === 'forbidden' ? <p role="alert">Operator is limited to the platform operator.</p> : null}
      {error === 'load' ? <p role="alert">Could not load the operator dashboard.</p> : null}

      {data ? (
        <>
          <section id="operator-health" aria-labelledby="operator-health-title" className="flex flex-col gap-3">
            <h2 id="operator-health-title" className="text-lg font-semibold">System health</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Checked {formatWhen(data.health.checkedAt)}.{data.health.stale ? ' This snapshot is stale.' : ' This snapshot is current.'}
            </p>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {([
                ['Hub', healthWord(data.health.hub)],
                ['Database', healthWord(data.health.database)],
                ['Rodrigo', healthWord(data.health.rodrigo)],
                ['OCR worker', healthWord(data.health.ocrWorker)],
                ['LLM control', healthWord(data.health.llm)],
                ['GPU headroom', data.health.gpu ? `${data.health.gpu.freeMiB} MiB free of ${data.health.gpu.totalMiB} on ${data.health.gpu.name}` : 'Unavailable'],
              ] as const).map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4">
                  <dt className="text-sm text-[var(--color-text-muted)]">{label}</dt>
                  <dd className="mt-1 text-base font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {data.droppedSamples > 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">{data.droppedSamples} metric samples were dropped because the buffer was full.</p>
            ) : null}
          </section>

          <section id="operator-activity" aria-labelledby="operator-activity-title" className="op-defer flex flex-col gap-3">
            <h2 id="operator-activity-title" className="text-lg font-semibold">Activity</h2>
            <DataTable
              caption="Recent app activity"
              headers={['App', 'Event', 'When', 'Workspace', 'Result']}
              rows={data.activity.map((item) => [
                item.appId,
                item.eventName,
                formatWhen(item.at),
                item.workspaceName,
                item.ok ? 'Success' : 'Failure',
              ])}
            />
          </section>

          <section id="operator-usage" aria-labelledby="operator-usage-title" className="op-defer flex flex-col gap-6">
            <h2 id="operator-usage-title" className="text-lg font-semibold">Usage over time</h2>
            <UsageChart title="Last 24 hours" points={data.usage.hours} />
            <UsageChart title="Last 14 days" points={data.usage.days} />
          </section>

          <section id="operator-load" aria-labelledby="operator-load-title" className="op-defer flex flex-col gap-3">
            <h2 id="operator-load-title" className="text-lg font-semibold">App load</h2>
            <p className="text-sm text-[var(--color-text-muted)]">Totals from the last 14 day buckets. Durations come from finished jobs, not from rereading documents.</p>
            <DataTable
              caption="App load for 14 days"
              headers={['App', 'Requests', 'Jobs', 'Errors', 'Average ms', 'Max ms']}
              rows={data.appLoad.map((app) => [
                app.appId,
                String(app.requests),
                String(app.jobs),
                String(app.errors),
                app.durationAvgMs == null ? '—' : String(app.durationAvgMs),
                app.durationMaxMs == null ? '—' : String(app.durationMaxMs),
              ])}
            />
          </section>

          <section id="operator-errors" aria-labelledby="operator-errors-title" className="op-defer flex flex-col gap-3">
            <h2 id="operator-errors-title" className="text-lg font-semibold">Errors</h2>
            <DataTable
              caption="Grouped errors"
              headers={['App', 'Route', 'Message', 'Count', 'Last seen', 'Location']}
              rows={data.errors.map((group) => [
                group.appId,
                group.route,
                group.message,
                String(group.count),
                formatWhen(group.lastSeen),
                group.location ?? '—',
              ])}
            />
          </section>

          <section id="operator-plans" aria-labelledby="operator-plans-title" className="op-defer flex flex-col gap-4">
            <h2 id="operator-plans-title" className="text-lg font-semibold">Subscriptions</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Plans are Free, Starter, Pro, and Enterprise. Max apps comes from the plan. A future effective date is stored as a schedule and does not charge a card.
            </p>
            <DataTable
              caption="Workspaces and plans"
              headers={['Workspace', 'Kind', 'Plan', 'Apps', 'Max apps', 'Schedule']}
              rows={data.workspaces.map((workspace) => [
                workspace.name,
                workspace.kind,
                workspace.planName,
                String(workspace.selectedAppCount),
                String(workspace.maxApps),
                workspace.schedule
                  ? `${workspace.schedule.subscriptionId} on ${formatWhen(workspace.schedule.effectiveAt)}${workspace.schedule.note ? ` (${workspace.schedule.note})` : ''}`
                  : 'None',
              ])}
            />
            <form action="/api/operator/plan" method="post" onSubmit={savePlan} aria-describedby={planHintId}>
              <fieldset className="max-w-xl">
                <legend className="mb-3 text-base font-medium">Set a plan</legend>
                <p id={planHintId} className="mb-3 text-sm text-[var(--color-text-muted)]">Leave the date empty to apply the plan now.</p>
                <div className="op-field">
                  <label htmlFor={`${planFormId}-workspace`}>Workspace</label>
                  <select id={`${planFormId}-workspace`} name="workspaceId" required autoComplete="off">
                    <option value="">Choose a workspace</option>
                    {data.workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                    ))}
                  </select>
                </div>
                <fieldset className="op-field">
                  <legend>Plan</legend>
                  {SUBSCRIPTION_PLANS.map((plan) => (
                    <label key={plan.id} className="flex items-center gap-2 py-1">
                      <input type="radio" name="subscriptionId" value={plan.id} required />
                      {plan.name} ({plan.maxApps} apps)
                    </label>
                  ))}
                </fieldset>
                <div className="op-field">
                  <label htmlFor={`${planFormId}-when`}>Effective date</label>
                  <input id={`${planFormId}-when`} name="effectiveAt" type="datetime-local" autoComplete="off" />
                </div>
                <div className="op-field">
                  <label htmlFor={`${planFormId}-note`}>Note</label>
                  <textarea id={`${planFormId}-note`} name="note" maxLength={240} rows={3} />
                </div>
                <button type="submit" disabled={planBusy}>{planBusy ? 'Saving plan' : 'Save plan'}</button>
                <p role="status" className="mt-2 text-sm">{planStatus}</p>
              </fieldset>
            </form>
          </section>

          <section id="operator-notices" aria-labelledby="operator-notices-title" className="op-defer flex flex-col gap-4">
            <h2 id="operator-notices-title" className="text-lg font-semibold">Notices</h2>
            <p className="text-sm text-[var(--color-text-muted)]">People only see the message text, and only when the audience and dates match. Dismiss is stored per person.</p>
            <DataTable
              caption="Operator notices"
              headers={['Message', 'Audience', 'Starts', 'Ends', 'Active']}
              rows={data.notices.map((notice) => [
                notice.message,
                notice.audience,
                notice.startsAt ? formatWhen(notice.startsAt) : 'Now',
                notice.endsAt ? formatWhen(notice.endsAt) : 'Open',
                notice.active ? 'Active' : 'Off',
              ])}
            />
            <ul className="flex flex-col gap-2">
              {data.notices.map((notice) => (
                <li key={notice.id}>
                  <button type="button" onClick={() => void setNoticeActive(notice.id, !notice.active)}>
                    {notice.active ? 'Turn off' : 'Turn on'} “{notice.message.slice(0, 80)}”
                  </button>
                </li>
              ))}
            </ul>
            <form action="/api/operator/notices" method="post" onSubmit={saveNotice} aria-describedby={noticeHintId}>
              <fieldset className="max-w-xl">
                <legend className="mb-3 text-base font-medium">Publish a notice</legend>
                <p id={noticeHintId} className="mb-3 text-sm text-[var(--color-text-muted)]">Write the sentence people should read. Do not include private document text.</p>
                <div className="op-field">
                  <label htmlFor={`${noticeFormId}-message`}>Message</label>
                  <textarea id={`${noticeFormId}-message`} name="message" required maxLength={400} rows={4} />
                </div>
                <fieldset className="op-field">
                  <legend>Audience</legend>
                  {AUDIENCES.map((audience) => (
                    <label key={audience.id} className="flex items-center gap-2 py-1">
                      <input type="radio" name="audience" value={audience.id} required defaultChecked={audience.id === 'all'} />
                      {audience.label}
                    </label>
                  ))}
                </fieldset>
                <div className="op-field">
                  <label htmlFor={`${noticeFormId}-start`}>Start</label>
                  <input id={`${noticeFormId}-start`} name="startsAt" type="datetime-local" autoComplete="off" />
                </div>
                <div className="op-field">
                  <label htmlFor={`${noticeFormId}-end`}>End</label>
                  <input id={`${noticeFormId}-end`} name="endsAt" type="datetime-local" autoComplete="off" />
                </div>
                <label className="mb-4 flex items-center gap-2">
                  <input type="checkbox" name="active" defaultChecked />
                  Active
                </label>
                <button type="submit" disabled={noticeBusy}>{noticeBusy ? 'Publishing notice' : 'Publish notice'}</button>
                <p role="status" className="mt-2 text-sm">{noticeStatus}</p>
              </fieldset>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}
