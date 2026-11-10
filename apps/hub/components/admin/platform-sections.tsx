'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { PlatformAuditEvent, PlatformAuditPage } from '@sorye/types';
import type { SharedAiView } from '@/lib/admin/shared-ai';
import type { IntegrationRow } from '@/lib/admin/platform-status';
import { OperatorPanels } from './operator-panels';
import { AdminTable, Badge, LoadNotice, PageHeader, type Tone } from './ui';
import { formatWhen, useAdminJson } from './use-admin-json';

type DeliveryRow = { appId: string; name: string; kind: 'micro-frontend' | 'external' | 'hub-native'; remoteName: string | null; source: string | null; applies: string };
type Watcher = { consumer: string; instanceId: string; configured: boolean; running: boolean; latestRevision: number | null; appliedRevision: number; lastCheckedAt: string | null; lastAppliedAt: string | null; lastError: string | null; source: string };
type Capabilities = { contractVersion?: string; service?: { name?: string; version?: string }; families?: unknown[]; platform?: { version: string; provider: string; namespaces: string[] } } & Record<string, unknown>;
type Backend = { status: 'up' | 'unavailable' | 'not_configured'; latencyMs?: number; capabilities?: Capabilities | null; topology?: Record<string, unknown> | null; watcher?: Watcher | null };
export type PlatformView = {
  access: { publicHost: string; adminHost: string; adminEmailCount: number; productionAdminFailsClosed: boolean; devBypass: boolean; nodeEnv: string; release: string | null };
  integrations: IntegrationRow[];
  delivery: DeliveryRow[];
  backend: Backend;
  checkedAt: string;
};

const PLATFORM_URL = '/api/admin/console/platform';
const INTEGRATION_TONE: Record<IntegrationRow['status'], Tone> = { configured: 'ok', not_configured: 'info', invalid: 'bad' };
const BACKEND_TONE: Record<Backend['status'], Tone> = { up: 'ok', unavailable: 'bad', not_configured: 'info' };

function BackendBadge({ backend }: { backend: Backend }) {
  const text = backend.status === 'up' ? `Up · ${backend.latencyMs ?? '?'} ms` : backend.status === 'not_configured' ? 'Not configured' : 'Unavailable';
  return <Badge tone={BACKEND_TONE[backend.status]}>{text}</Badge>;
}

export function OverviewStatus() {
  const platform = useAdminJson<PlatformView>(PLATFORM_URL, 30_000);
  const ai = useAdminJson<SharedAiView>('/api/admin/console/config/shared-ai', 30_000);
  const drift = ai.state.kind === 'ready'
    ? ai.state.data.consumers.filter((consumer) => consumer.propagation !== 'applied')
    : [];
  return (
    <section className="admin-section" aria-labelledby="overview-platform-title">
      <h2 id="overview-platform-title">Platform</h2>
      <LoadNotice state={platform.state} what="platform status" />
      <dl className="admin-cards">
        {platform.state.kind === 'ready' ? (
          <>
            <div className="admin-card"><dt>Rodrigo backend</dt><dd><BackendBadge backend={platform.state.data.backend} /></dd></div>
            <div className="admin-card"><dt>Administrators</dt><dd>{platform.state.data.access.adminEmailCount} listed{platform.state.data.access.devBypass ? ' · development bypass on' : ''}</dd></div>
            <div className="admin-card"><dt>Release</dt><dd>{platform.state.data.access.release ?? 'not set'} · {platform.state.data.access.nodeEnv}</dd></div>
          </>
        ) : null}
        {ai.state.kind === 'ready' ? (
          <div className="admin-card">
            <dt>Shared AI</dt>
            <dd>
              {ai.state.data.store !== 'ready'
                ? <Badge tone="warn">Store {ai.state.data.store.replace('_', ' ')}</Badge>
                : drift.length === 0
                  ? <Badge tone="ok">Revision {ai.state.data.revision} applied everywhere</Badge>
                  : <Link href="/admin/ai"><Badge tone="warn">{drift.length} consumer{drift.length === 1 ? '' : 's'} not on revision {ai.state.data.revision}</Badge></Link>}
              {ai.state.data.hubEffective.paused ? <> <Badge tone="warn">Paused</Badge></> : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

export function IntegrationsSection() {
  const platform = useAdminJson<PlatformView>(PLATFORM_URL, 60_000);
  return (
    <div className="admin-page">
      <PageHeader
        title="Integrations and storage"
        intro="Which external services and stores this deployment is wired to. Only configured flags and hostnames are shown; secrets never leave the server. These are deployment inputs: change them in the environment and redeploy."
      />
      <LoadNotice state={platform.state} what="integration status" />
      {platform.state.kind === 'ready' ? (
        <AdminTable
          caption="Integrations"
          rows={platform.state.data.integrations}
          rowKey={(row) => row.id}
          empty="No integrations."
          columns={[
            { header: 'Integration', cell: (row) => row.label },
            { header: 'Status', cell: (row) => <Badge tone={INTEGRATION_TONE[row.status]}>{row.status.replace('_', ' ')}</Badge> },
            { header: 'Detail', cell: (row) => row.detail ?? '—' },
            { header: 'Changed by', cell: (row) => row.managedBy === 'deployment' ? 'Deployment' : row.managedBy },
          ]}
        />
      ) : null}
      <section className="admin-section">
        <h2>Workspace-level storage</h2>
        <p className="admin-muted">
          Workspace cloud-storage connections (Relay) and optional workspace databases (Drive) are owned by each workspace and encrypted at rest.
          The console does not read or reveal those credentials. See the Relay and Drive rows under <Link href="/admin/applications">Applications</Link>.
        </p>
      </section>
    </div>
  );
}

export function ReleasesSection() {
  const platform = useAdminJson<PlatformView>(PLATFORM_URL, 30_000);
  const data = platform.state.kind === 'ready' ? platform.state.data : null;
  const watcher = data?.backend.watcher ?? null;
  return (
    <div className="admin-page">
      <PageHeader
        title="Releases and infrastructure"
        intro="What each app is served from and how a change reaches users. Image promotion and deployment happen in the delivery pipeline, not here."
      />
      <LoadNotice state={platform.state} what="infrastructure status" />
      {data ? (
        <>
          <dl className="admin-cards">
            <div className="admin-card"><dt>Hub release</dt><dd>{data.access.release ?? 'SENTRY_RELEASE not set'}</dd></div>
            <div className="admin-card"><dt>Customer host</dt><dd>{data.access.publicHost}</dd></div>
            <div className="admin-card"><dt>Admin host</dt><dd>{data.access.adminHost}</dd></div>
            <div className="admin-card"><dt>Rodrigo</dt><dd><BackendBadge backend={data.backend} /></dd></div>
          </dl>
          <section className="admin-section" aria-labelledby="releases-watcher-title">
            <h2 id="releases-watcher-title">Configuration watcher (this Hub process)</h2>
            {watcher ? (
              <dl className="admin-cards">
                <div className="admin-card"><dt>Latest revision seen</dt><dd>{watcher.latestRevision ?? '—'}</dd></div>
                <div className="admin-card"><dt>Applied revision</dt><dd>{watcher.appliedRevision} ({watcher.source})</dd></div>
                <div className="admin-card"><dt>Last checked</dt><dd>{formatWhen(watcher.lastCheckedAt)}</dd></div>
                <div className="admin-card"><dt>Last error</dt><dd>{watcher.lastError ? <Badge tone="warn">{watcher.lastError}</Badge> : 'none'}</dd></div>
              </dl>
            ) : <p className="admin-muted">The watcher is not running in this process (Rodrigo is not configured).</p>}
          </section>
          {data.backend.capabilities ? (
            <details className="admin-details">
              <summary>Rodrigo capabilities (contract {String(data.backend.capabilities.contractVersion ?? '?')}, platform {data.backend.capabilities.platform?.provider ?? 'not advertised'})</summary>
              <pre>{JSON.stringify(data.backend.capabilities, null, 2)}</pre>
            </details>
          ) : null}
          {data.backend.topology ? (
            <details className="admin-details">
              <summary>Rodrigo topology</summary>
              <pre>{JSON.stringify(data.backend.topology, null, 2)}</pre>
            </details>
          ) : null}
          <AdminTable
            caption="Frontend delivery"
            rows={data.delivery}
            rowKey={(row) => row.appId}
            empty="No apps."
            columns={[
              { header: 'App', cell: (row) => <Link href={`/admin/applications/${row.appId}`}>{row.name}</Link> },
              { header: 'Kind', cell: (row) => row.kind },
              { header: 'Served from', cell: (row) => row.source ?? 'Hub' },
              { header: 'A change applies by', cell: (row) => row.applies },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}

function describeEvent(event: PlatformAuditEvent): string {
  const details = event.details as Record<string, unknown>;
  if (event.targetType === 'platformConfig') {
    const rolledBack = typeof details.rolledBackTo === 'number' ? ` (restored revision ${details.rolledBackTo})` : '';
    if (event.outcome === 'conflict') return `Rejected stale write to ${event.targetId}`;
    return `${event.targetId} → revision ${event.revision ?? '?'}${rolledBack}`;
  }
  return `${event.action.replace(/[._]/g, ' ')} · ${event.targetType} ${event.targetId}`;
}

const OUTCOME_TONE: Record<string, Tone> = { committed: 'ok', succeeded: 'ok', pending: 'info', conflict: 'warn', failed: 'bad', denied: 'bad' };

function ChangedFields({ event }: { event: PlatformAuditEvent }) {
  const details = event.details as { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; reason?: string };
  if (event.targetType !== 'platformConfig') {
    const flat = Object.entries(details).filter(([, value]) => typeof value !== 'object' || value === null);
    return flat.length ? <span>{flat.map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</span> : <span>—</span>;
  }
  const before = details.before ?? {};
  const after = details.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  return (
    <span>
      {keys.length ? keys.map((key) => `${key}: ${JSON.stringify(before[key] ?? null)} → ${JSON.stringify(after[key] ?? null)}`).join('; ') : 'no value change'}
      {details.reason ? ` — “${details.reason}”` : ''}
    </span>
  );
}

export function HistorySection() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  const url = `/api/admin/console/audit?limit=50${cursor ? `&cursor=${cursor}` : ''}`;
  const page = useAdminJson<PlatformAuditPage>(url, cursor ? 0 : 30_000);
  return (
    <div className="admin-page">
      <PageHeader
        title="Configuration history"
        intro="Append-only audit trail from Rodrigo: configuration revisions with before and after values, stale-write rejections, and console actions such as plan changes, notices and engine stops. Newest first."
      />
      <LoadNotice state={page.state} what="the audit trail" />
      {page.state.kind === 'ready' ? (
        <>
          <AdminTable
            caption={cursor ? 'Older audit events' : 'Latest audit events'}
            rows={page.state.data.events}
            rowKey={(row) => row.auditId}
            empty="No audit events yet."
            columns={[
              { header: 'When', cell: (row) => formatWhen(row.occurredAt) },
              { header: 'What', cell: (row) => describeEvent(row) },
              { header: 'Outcome', cell: (row) => <Badge tone={OUTCOME_TONE[row.outcome] ?? 'info'}>{row.outcome}</Badge> },
              { header: 'Who', cell: (row) => row.actorId },
              { header: 'Changes', cell: (row) => <ChangedFields event={row} /> },
              { header: 'Reference', cell: (row) => <code title={row.correlationId}>{row.auditId.slice(0, 8)}</code> },
            ]}
          />
          <div className="admin-actions">
            {trail.length ? <button type="button" className="admin-button" onClick={() => { const previous = trail.slice(0, -1); setTrail(previous); setCursor(trail.at(-1) || null); }}>Newer</button> : null}
            {page.state.data.nextCursor ? <button type="button" className="admin-button" onClick={() => { setTrail([...trail, cursor ?? '']); setCursor(page.state.kind === 'ready' ? page.state.data.nextCursor : null); }}>Older</button> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

type WorkspaceDetail = {
  workspace: { id: string; name: string; kind: string; subscriptionId: string; planName: string; maxApps: number; selectedAppCount: number; apps: { id: string; name: string; alwaysAvailable: boolean }[]; schedule: { subscriptionId: string; effectiveAt: string } | null };
  members: { id: string; displayName: string; email: string }[];
  membersTruncated: boolean;
};

function WorkspaceReview({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const detail = useAdminJson<WorkspaceDetail>(`/api/admin/console/workspaces/${encodeURIComponent(workspaceId)}`);
  return (
    <section className="admin-section" aria-labelledby="workspace-review-title">
      <div className="admin-actions">
        <h2 id="workspace-review-title">Workspace access review</h2>
        <button type="button" className="admin-button" onClick={onClose}>Close review</button>
      </div>
      <LoadNotice state={detail.state} what="the workspace" />
      {detail.state.kind === 'ready' ? (() => {
        const { workspace, members, membersTruncated } = detail.state.data;
        return (
          <>
            <dl className="admin-cards">
              <div className="admin-card"><dt>Workspace</dt><dd>{workspace.name} · {workspace.kind}</dd></div>
              <div className="admin-card"><dt>Plan</dt><dd>{workspace.planName}{workspace.schedule ? ` · changes to ${workspace.schedule.subscriptionId} ${formatWhen(workspace.schedule.effectiveAt)}` : ''}</dd></div>
              <div className="admin-card"><dt>Apps in use</dt><dd>{workspace.selectedAppCount} of {workspace.maxApps}</dd></div>
            </dl>
            <p className="admin-muted">Apps: {workspace.apps.map((app) => app.name + (app.alwaysAvailable ? ' (always on)' : '')).join(', ') || 'none'}</p>
            <AdminTable
              caption={`Members${membersTruncated ? ' (first 200)' : ''}`}
              rows={members}
              rowKey={(row) => row.id}
              empty="No members."
              columns={[
                { header: 'Name', cell: (row) => row.displayName || '—' },
                { header: 'Email', cell: (row) => row.email },
              ]}
            />
            <p className="admin-hint">Membership is read-only here. Invitations are not implemented; owners manage their workspace inside the Hub.</p>
          </>
        );
      })() : null}
    </section>
  );
}

export function WorkspacesConsole() {
  const [selected, setSelected] = useState<string | null>(null);
  const platform = useAdminJson<PlatformView>(PLATFORM_URL);
  return (
    <>
      {selected ? <div className="admin-page"><WorkspaceReview workspaceId={selected} onClose={() => setSelected(null)} /></div> : null}
      <OperatorPanels
        sections={['plans', 'notices']}
        title="Workspaces and access"
        intro="Choose a workspace explicitly before changing its plan. Plan and notice changes are recorded in the audit log; if the audit log is unavailable, nothing is changed."
        onWorkspaceSelect={setSelected}
      />
      <div className="admin-page">
        <section className="admin-section" aria-labelledby="access-policy-title">
          <h2 id="access-policy-title">Administrator access</h2>
          {platform.state.kind === 'ready' ? (
            <dl className="admin-cards">
              <div className="admin-card"><dt>Admin host</dt><dd>{platform.state.data.access.adminHost}</dd></div>
              <div className="admin-card"><dt>Administrators (ADMIN_EMAILS)</dt><dd>{platform.state.data.access.adminEmailCount}</dd></div>
              <div className="admin-card"><dt>Empty list in production</dt><dd>Nobody is an administrator (fails closed)</dd></div>
            </dl>
          ) : <LoadNotice state={platform.state} what="access policy" />}
          <p className="admin-hint">The administrator list is a deployment input. Changing it requires a redeploy so that a compromised console session cannot grant itself or others access.</p>
        </section>
      </div>
    </>
  );
}
