'use client';

import Link from 'next/link';
import type { SettingEntry, SettingsArea, SettingStatus } from '@/lib/admin/settings-inventory';
import { AdminTable, Badge, PageHeader, type Tone } from './ui';

const STATUS: Record<SettingStatus, { text: string; tone: Tone }> = {
  console: { text: 'Console', tone: 'ok' },
  'owner-app': { text: 'In the app', tone: 'info' },
  'read-only': { text: 'Read-only', tone: 'info' },
  deployment: { text: 'Deployment', tone: 'warn' },
  constant: { text: 'Code constant', tone: 'info' },
  'not-implemented': { text: 'Not implemented', tone: 'bad' },
};

type Delivery = { kind: string; source: string | null; applies: string } | null;

function counts(area: SettingsArea) {
  const editable = area.settings.filter((setting) => setting.status === 'console').length;
  const deployment = area.settings.filter((setting) => setting.status === 'deployment').length;
  return `${area.settings.length} setting${area.settings.length === 1 ? '' : 's'}${editable ? ` · ${editable} in console` : ''}${deployment ? ` · ${deployment} deployment` : ''}`;
}

export function ApplicationsIndex({ areas, delivery }: { areas: SettingsArea[]; delivery: Record<string, Delivery> }) {
  const apps = areas.filter((area) => area.kind !== 'platform');
  const platform = areas.filter((area) => area.kind === 'platform');
  const columns = [
    { header: 'Area', cell: (row: SettingsArea) => <Link href={`/admin/applications/${row.id}`}>{row.title}</Link> },
    { header: 'Summary', cell: (row: SettingsArea) => row.summary },
    { header: 'Delivery', cell: (row: SettingsArea) => delivery[row.id]?.kind ?? (row.kind === 'retired' ? 'retired' : 'platform') },
    { header: 'Settings', cell: (row: SettingsArea) => counts(row) },
    { header: 'Gaps', cell: (row: SettingsArea) => row.gaps.length || '—' },
  ];
  return (
    <div className="admin-page">
      <PageHeader
        title="Applications"
        intro="Every catalog app and platform area, with where each setting lives and who may change it. Most app settings belong to workspace members inside the app; the console edits only platform-wide settings, and shows the rest so nothing is hidden."
      />
      <AdminTable caption="Catalog apps" rows={apps} rowKey={(row) => row.id} empty="No apps." columns={columns} />
      <AdminTable caption="Platform areas" rows={platform} rowKey={(row) => row.id} empty="No areas." columns={columns} />
      <p className="admin-hint">The same inventory is published as docs/admin/SETTINGS-MATRIX.md.</p>
    </div>
  );
}

export function ApplicationDetail({ area, delivery }: { area: SettingsArea; delivery: Delivery }) {
  return (
    <div className="admin-page">
      <p><Link href="/admin/applications">← Applications</Link></p>
      <PageHeader title={area.title} intro={area.summary} />
      {delivery ? (
        <dl className="admin-cards">
          <div className="admin-card"><dt>Delivery</dt><dd>{delivery.kind}</dd></div>
          <div className="admin-card"><dt>Served from</dt><dd>{delivery.source ?? 'Hub'}</dd></div>
          <div className="admin-card"><dt>A change applies by</dt><dd>{delivery.applies}</dd></div>
        </dl>
      ) : null}
      <AdminTable
        caption="Settings"
        rows={area.settings}
        rowKey={(row: SettingEntry) => row.key}
        empty="No settings."
        columns={[
          { header: 'Setting', cell: (row) => <>{row.label}<br /><code>{row.key}</code></> },
          { header: 'Status', cell: (row) => <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].text}</Badge> },
          { header: 'Scope', cell: (row) => row.scope },
          { header: 'Stored in', cell: (row) => row.store },
          { header: 'Changed by', cell: (row) => row.consoleHref && row.status === 'console' ? <Link href={row.consoleHref}>{row.changedBy}</Link> : row.changedBy },
          { header: 'Sensitivity', cell: (row) => row.sensitivity },
          { header: 'Applies', cell: (row) => row.applies },
        ]}
      />
      {area.gaps.length ? (
        <section className="admin-section" aria-labelledby="app-gaps-title">
          <h2 id="app-gaps-title">Known gaps</h2>
          <ul className="admin-muted">{area.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
