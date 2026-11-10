/**
 * Settings inventory for the administration console and docs/admin/SETTINGS-MATRIX.md.
 * Static and secret-free: it names settings and their owners, never their values.
 * test/admin-settings-inventory.test.ts requires an entry for every APP_CATALOG id.
 */

/**
 * - `console`: changed in the administration console (audited).
 * - `owner-app`: changed by workspace members/owners inside the owning app; the console only points there.
 * - `read-only`: observable state with no write path.
 * - `deployment`: environment or build input; changed by redeploying.
 * - `constant`: fixed in code; changed by a release.
 * - `not-implemented`: the capability does not exist; shown so nobody assumes it does.
 */
export type SettingStatus = 'console' | 'owner-app' | 'read-only' | 'deployment' | 'constant' | 'not-implemented';
export type SettingScope = 'platform' | 'workspace' | 'user' | 'deployment';
export type SettingSensitivity = 'public' | 'internal' | 'secret';
/** How a change reaches running code. */
export type SettingApplies = 'next-request' | 'propagated' | 'restart' | 'rebuild' | 'release' | 'n/a';

export interface SettingEntry {
  key: string;
  label: string;
  status: SettingStatus;
  scope: SettingScope;
  /** Durable owner of the value. */
  store: string;
  changedBy: string;
  sensitivity: SettingSensitivity;
  applies: SettingApplies;
  /** Console section that edits or shows it, when there is one. */
  consoleHref?: string;
  source: string;
}

export interface SettingsArea {
  id: string;
  kind: 'app' | 'platform' | 'retired';
  title: string;
  summary: string;
  settings: SettingEntry[];
  gaps: string[];
}

const member = 'Workspace member (in the app)';
const owner = 'Workspace owner (in the app)';
const deployer = 'Deployer (environment, redeploy)';
const release = 'Code release';
const admin = 'Platform administrator (console, audited)';

const remote = (appId: string, env: string): SettingEntry => ({
  key: `${appId}.remoteEntry`, label: 'Remote entry URL', status: 'deployment', scope: 'deployment', store: env,
  changedBy: deployer, sensitivity: 'public', applies: 'rebuild', consoleHref: '/admin/releases', source: 'apps/hub/lib/mf-remotes.ts',
});
const rodrigoFamily = (key: string, label: string, family: string, changedBy = member): SettingEntry => ({
  key, label, status: 'owner-app', scope: 'workspace', store: `Rodrigo ${family}`, changedBy, sensitivity: 'internal',
  applies: 'next-request', source: 'apps/hub/lib/rodrigo/action-validation.ts',
});

export const SETTINGS_INVENTORY: SettingsArea[] = [
  {
    id: 'catalog', kind: 'app', title: 'Catalog', summary: 'Always-available app list; reads APP_CATALOG at runtime.',
    settings: [
      { key: 'catalog.entries', label: 'Catalog entries and descriptions', status: 'constant', scope: 'platform', store: 'packages/types/src/apps.ts', changedBy: release, sensitivity: 'public', applies: 'release', consoleHref: '/admin/applications', source: 'packages/types/src/apps.ts' },
    ],
    gaps: ['No catalog-specific settings; it is pinned for every workspace and cannot be turned off.'],
  },
  {
    id: 'contact', kind: 'app', title: 'Contact', summary: 'Public presentation page at /contact; not part of customer chrome.',
    settings: [
      { key: 'contact.page', label: 'Page content', status: 'constant', scope: 'platform', store: 'Hub source', changedBy: release, sensitivity: 'public', applies: 'release', source: 'apps/hub/app/contact' },
    ],
    gaps: ['No configurable content or form destination.'],
  },
  {
    id: 'dashboard', kind: 'app', title: 'Dashboard', summary: 'Workspace overview, event opt-in, analytics and personal GPU preference.',
    settings: [
      remote('dashboard', 'NEXT_PUBLIC_DASHBOARD_REMOTE'),
      { key: 'events.enabled', label: 'Workspace event bus opt-in', status: 'owner-app', scope: 'workspace', store: 'Hub event-settings.json / Postgres', changedBy: member, sensitivity: 'internal', applies: 'next-request', source: 'apps/hub/app/api/events/route.ts' },
      { key: 'events.deliverToMessengerEvents', label: 'Deliver events to Messenger', status: 'owner-app', scope: 'workspace', store: 'Hub event-settings.json / Postgres', changedBy: member, sensitivity: 'internal', applies: 'next-request', source: 'apps/hub/app/api/events/route.ts' },
      { key: 'llm.userGpuPreference', label: 'Personal GPU preference (target, WebGPU model, host GPU index)', status: 'owner-app', scope: 'user', store: 'Hub llm-control.json userGpuPreferences', changedBy: 'Signed-in user', sensitivity: 'internal', applies: 'next-request', source: 'apps/hub/app/api/llm/preferences/route.ts' },
      { key: 'analytics', label: 'Analytics snapshot', status: 'read-only', scope: 'workspace', store: 'Derived', changedBy: 'n/a', sensitivity: 'internal', applies: 'n/a', source: 'apps/hub/app/api/analytics/route.ts' },
    ],
    gaps: ['The shared AI engine moved to the administration console; Dashboard only shows a pointer to it.', 'No persisted per-widget layout.'],
  },
  {
    id: 'notes', kind: 'app', title: 'Notes', summary: 'Workspace notes stored in Rodrigo.',
    settings: [remote('notes', 'NEXT_PUBLIC_NOTES_REMOTE'), rodrigoFamily('notes.note', 'Notes (title ≤500, body ≤100000)', 'notes.note')],
    gaps: ['No per-note sharing or visibility settings.'],
  },
  {
    id: 'calendar', kind: 'app', title: 'Calendar', summary: 'Workspace events stored in Rodrigo.',
    settings: [remote('calendar', 'NEXT_PUBLIC_CALENDAR_REMOTE'), rodrigoFamily('calendar.event', 'Events (timed, all-day, multi-date ≤366 days)', 'calendar.event')],
    gaps: ['Timezone comes from the workspace profile; no per-calendar timezone.'],
  },
  {
    id: 'relay', kind: 'app', title: 'Relay', summary: 'Routes app events to channels.',
    settings: [
      remote('relay', 'NEXT_PUBLIC_RELAY_REMOTE'),
      { key: 'relay.sources', label: 'Enabled sources', status: 'owner-app', scope: 'workspace', store: 'Hub relay.json / Postgres', changedBy: member, sensitivity: 'internal', applies: 'next-request', source: 'apps/hub/app/api/relay/route.ts' },
      { key: 'relay.channels', label: 'Channels (webhook URLs are SSRF-checked)', status: 'owner-app', scope: 'workspace', store: 'Hub relay.json / Postgres', changedBy: member, sensitivity: 'internal', applies: 'next-request', source: 'apps/hub/lib/relay.ts' },
      { key: 'relay.routes', label: 'Source-to-channel routes', status: 'owner-app', scope: 'workspace', store: 'Hub relay.json / Postgres', changedBy: member, sensitivity: 'internal', applies: 'next-request', source: 'apps/hub/app/api/relay/route.ts' },
      { key: 'relay.quietHours', label: 'Quiet hours (default off, 22:00–07:00)', status: 'owner-app', scope: 'workspace', store: 'Hub relay.json / Postgres', changedBy: member, sensitivity: 'internal', applies: 'next-request', source: 'apps/hub/lib/relay.ts' },
      { key: 'relay.storages', label: 'Cloud storage connections (credentials encrypted)', status: 'owner-app', scope: 'workspace', store: 'Hub relay-storages.json (STORAGE_SECRET_KEY)', changedBy: 'Platform administrator (in Relay)', sensitivity: 'secret', applies: 'next-request', source: 'apps/hub/app/api/relay/storages/route.ts' },
    ],
    gaps: ['Email and WhatsApp channels queue messages but do not deliver.', 'Rodrigo relay.config exists in the contract but the Relay UI still writes relay.json.'],
  },
  {
    id: 'storefront', kind: 'app', title: 'Storefront', summary: 'Products and order requests.',
    settings: [
      rodrigoFamily('storefront.product', 'Products', 'storefront.product', owner),
      rodrigoFamily('storefront.order', 'Order requests', 'storefront.order'),
    ],
    gaps: ['No checkout or payment provider (Stripe is not implemented).'],
  },
  {
    id: 'site', kind: 'app', title: 'Site', summary: 'Public workspace page at /s/<slug>.',
    settings: [rodrigoFamily('site.page', 'Page slug, title, published flag, blocks (≤100)', 'site.page', owner)],
    gaps: ['No custom domains.'],
  },
  {
    id: 'devtools', kind: 'app', title: 'DevKit', summary: 'Embed widgets and developer tooling.',
    settings: [
      remote('devtools', 'NEXT_PUBLIC_DEVKIT_REMOTE'),
      { key: 'embed.widgets', label: 'Embed widgets (name, allowed origins, enabled apps)', status: 'owner-app', scope: 'workspace', store: 'Hub embed.json / Postgres', changedBy: member, sensitivity: 'internal', applies: 'next-request', source: 'apps/hub/app/api/embed/widgets/route.ts' },
      { key: 'embed.apiKey', label: 'Widget API key (shown once, then only a hint)', status: 'owner-app', scope: 'workspace', store: 'Hub embed store (hashed)', changedBy: member, sensitivity: 'secret', applies: 'next-request', source: 'apps/hub/lib/store/embed-json.ts' },
    ],
    gaps: [],
  },
  {
    id: 'protocolio', kind: 'app', title: 'Protocolio', summary: 'Templates and PDF generation through the Protocolio renderer.',
    settings: [
      remote('protocolio', 'NEXT_PUBLIC_PROTOCOLIO_REMOTE'),
      rodrigoFamily('protocolio.artifact', 'Template artifacts', 'protocolio.artifact'),
      { key: 'PROTOCOLIO_API_URL', label: 'Renderer URL', status: 'deployment', scope: 'deployment', store: 'Environment', changedBy: deployer, sensitivity: 'internal', applies: 'restart', consoleHref: '/admin/integrations', source: 'apps/hub/lib/protocolio-bridge.ts' },
      { key: 'PROTOCOLIO_SERVICE_TOKEN', label: 'Renderer service token', status: 'deployment', scope: 'deployment', store: 'Environment / secret file', changedBy: deployer, sensitivity: 'secret', applies: 'restart', consoleHref: '/admin/integrations', source: 'apps/hub/lib/protocolio-bridge.ts' },
    ],
    gaps: ['No per-workspace renderer credentials.'],
  },
  {
    id: 'canvas', kind: 'app', title: 'Canvas', summary: 'Boards stored in Rodrigo.',
    settings: [remote('canvas', 'NEXT_PUBLIC_CANVAS_REMOTE'), rodrigoFamily('canvas.board', 'Boards (title ≤200)', 'canvas.board')],
    gaps: ['No per-board access control beyond workspace membership.'],
  },
  {
    id: 'tasks', kind: 'app', title: 'Tasks', summary: 'Task board stored in Rodrigo.',
    settings: [remote('tasks', 'NEXT_PUBLIC_TASKS_REMOTE'), rodrigoFamily('tasks.taskBoard', 'Board statuses (≤30) and tasks (≤500)', 'tasks.taskBoard')],
    gaps: ['No task notification preferences.'],
  },
  {
    id: 'messenger', kind: 'app', title: 'Messenger', summary: 'Channels and messages stored in Rodrigo.',
    settings: [remote('messenger', 'NEXT_PUBLIC_MESSENGER_REMOTE'), rodrigoFamily('messenger.*', 'Channels, messages, reactions', 'messenger.*')],
    gaps: ['No retention policy or encryption settings.'],
  },
  {
    id: 'mail', kind: 'app', title: 'Mail', summary: 'Personal mailbox profile and connected IMAP/SMTP accounts.',
    settings: [
      { key: 'mail.profile', label: 'Personal email and Messenger notification', status: 'owner-app', scope: 'user', store: 'Hub mail.json / Postgres', changedBy: 'Signed-in user', sensitivity: 'internal', applies: 'next-request', source: 'apps/hub/app/api/mail/route.ts' },
      { key: 'mail.accounts', label: 'Connected accounts (≤8, passwords write-only)', status: 'owner-app', scope: 'user', store: 'Hub mail.json (encrypted)', changedBy: 'Signed-in user', sensitivity: 'secret', applies: 'next-request', source: 'apps/hub/app/api/mail/accounts/route.ts' },
      { key: 'MAIL_SECRET_KEY', label: 'Mail credential encryption key', status: 'deployment', scope: 'deployment', store: 'Environment', changedBy: deployer, sensitivity: 'secret', applies: 'restart', consoleHref: '/admin/integrations', source: 'apps/hub/lib/storage-crypto.ts' },
    ],
    gaps: ['Hub is not a public mail server; no workspace-wide SMTP settings.'],
  },
  {
    id: 'files', kind: 'app', title: 'Drive', summary: 'Workspace files; blobs local or S3-compatible.',
    settings: [
      { key: 'files.limits', label: 'Upload limits (64 MB per file, 200 per workspace)', status: 'constant', scope: 'platform', store: 'packages/types/src/files.ts', changedBy: release, sensitivity: 'public', applies: 'release', source: 'packages/types/src/files.ts' },
      { key: 'FILE_STORE_DRIVER', label: 'Blob driver and S3 settings', status: 'deployment', scope: 'deployment', store: 'Environment (FILE_S3_*)', changedBy: deployer, sensitivity: 'secret', applies: 'restart', consoleHref: '/admin/integrations', source: 'apps/hub/lib/file-blobs.ts' },
      { key: 'workspace.storage', label: 'Optional workspace Postgres connection', status: 'owner-app', scope: 'workspace', store: 'Hub workspace-storage.json (encrypted, hints only)', changedBy: member, sensitivity: 'secret', applies: 'next-request', source: 'apps/hub/app/api/workspace/storage/route.ts' },
    ],
    gaps: ['No per-folder permissions.'],
  },
  {
    id: 'susm', kind: 'app', title: 'SUSM', summary: 'External site embedded by URL.',
    settings: [{ key: 'susm.url', label: 'External URL', status: 'constant', scope: 'platform', store: 'packages/types/src/apps.ts', changedBy: release, sensitivity: 'public', applies: 'release', consoleHref: '/admin/releases', source: 'packages/types/src/apps.ts' }],
    gaps: ['No Hub-side settings; sign-in happens on the external site.'],
  },
  {
    id: 'espm', kind: 'app', title: 'ESPM', summary: 'External site embedded by URL.',
    settings: [{ key: 'espm.url', label: 'External URL', status: 'constant', scope: 'platform', store: 'packages/types/src/apps.ts', changedBy: release, sensitivity: 'public', applies: 'release', consoleHref: '/admin/releases', source: 'packages/types/src/apps.ts' }],
    gaps: ['No Hub-side settings.'],
  },
  {
    id: 'ocr', kind: 'app', title: 'OCR', summary: 'Document analysis on the shared AI engine or the browser GPU.',
    settings: [
      remote('ocr', 'NEXT_PUBLIC_OCR_REMOTE'),
      { key: 'shared-ai', label: 'Shared AI engine (provider, URL, model, limits, GPU, paused)', status: 'console', scope: 'platform', store: 'Rodrigo platform config (shared-ai)', changedBy: admin, sensitivity: 'internal', applies: 'propagated', consoleHref: '/admin/ai', source: 'apps/hub/lib/admin/shared-ai.ts' },
      { key: 'shared-ai.stop', label: 'Stop Hub-local requests and unload the model (after pausing)', status: 'console', scope: 'platform', store: 'Hub process', changedBy: admin, sensitivity: 'internal', applies: 'next-request', consoleHref: '/admin/ai', source: 'apps/hub/app/api/admin/llm/action/route.ts' },
      { key: 'OCR_LLM_*', label: 'Bootstrap engine when no Rodrigo revision exists', status: 'deployment', scope: 'deployment', store: 'Environment', changedBy: deployer, sensitivity: 'internal', applies: 'restart', consoleHref: '/admin/ai', source: 'apps/hub/lib/llm-control.ts' },
      { key: 'ocr.limits', label: 'Limits (64 MB PDF, 500 pages, 50 analyses)', status: 'constant', scope: 'platform', store: 'Hub source', changedBy: release, sensitivity: 'public', applies: 'release', source: 'apps/hub/lib/security-limits.ts' },
      { key: 'OCR_WORKER_HEALTH_FILE', label: 'Worker heartbeat file', status: 'deployment', scope: 'deployment', store: 'Environment', changedBy: deployer, sensitivity: 'internal', applies: 'restart', source: 'apps/hub/lib/workers/ocr-worker.ts' },
    ],
    gaps: ['No per-workspace model override.', 'Stop does not cancel requests already running in the OCR worker; pause stops it from starting new ones.'],
  },
  {
    id: 'studio', kind: 'app', title: 'Studio', summary: 'Media projects stored in Rodrigo; uploads go to Drive.',
    settings: [remote('studio', 'NEXT_PUBLIC_STUDIO_REMOTE'), rodrigoFamily('studio.project', 'Projects (name ≤200, asset refs ≤1000)', 'studio.project')],
    gaps: ['GPU monitor thresholds are fixed in code.'],
  },
  {
    id: 'reports', kind: 'app', title: 'Reports', summary: 'Admin-only usage counts in the customer Hub.',
    settings: [{ key: 'reports.range', label: 'Report window (7, 14, 30, 90 days)', status: 'constant', scope: 'platform', store: 'packages/types/src/reports.ts', changedBy: release, sensitivity: 'internal', applies: 'release', source: 'apps/hub/app/api/reports/route.ts' }],
    gaps: ['No export.'],
  },
  {
    id: 'operator', kind: 'retired', title: 'Operator (retired)', summary: 'Removed from the customer Hub. Its health, plans, notices, usage and load views are now console sections.',
    settings: [
      { key: 'workspace.subscriptionId', label: 'Workspace plan (immediate or scheduled)', status: 'console', scope: 'workspace', store: 'Hub store.json / Postgres', changedBy: admin, sensitivity: 'internal', applies: 'next-request', consoleHref: '/admin/workspaces', source: 'apps/hub/app/api/operator/plan/route.ts' },
      { key: 'operator.notices', label: 'Platform notices (≤40, message ≤400)', status: 'console', scope: 'platform', store: 'Hub operator-notices.json / Postgres', changedBy: admin, sensitivity: 'public', applies: 'next-request', consoleHref: '/admin/workspaces', source: 'apps/hub/app/api/operator/notices/route.ts' },
    ],
    gaps: ['/apps/operator on the customer host redirects to the console.'],
  },
  {
    id: 'platform.access', kind: 'platform', title: 'Authentication and access', summary: 'Sign-in, administrator list and host separation.',
    settings: [
      { key: 'AUTH_GOOGLE_ID', label: 'Google OAuth client (callbacks for both hosts)', status: 'deployment', scope: 'deployment', store: 'Environment', changedBy: deployer, sensitivity: 'secret', applies: 'restart', consoleHref: '/admin/integrations', source: 'apps/hub/lib/env.ts' },
      { key: 'AUTH_SECRET', label: 'Session signing secret', status: 'deployment', scope: 'deployment', store: 'Environment', changedBy: deployer, sensitivity: 'secret', applies: 'restart', source: 'apps/hub/lib/env.ts' },
      { key: 'ADMIN_EMAILS', label: 'Platform administrators (production fails closed when empty)', status: 'deployment', scope: 'deployment', store: 'Environment', changedBy: deployer, sensitivity: 'internal', applies: 'restart', consoleHref: '/admin/workspaces', source: 'apps/hub/lib/platform-admin.ts' },
      { key: 'SORYE_ADMIN_HOST', label: 'Admin and public hostnames', status: 'deployment', scope: 'deployment', store: 'Environment (SORYE_PUBLIC_HOST, SORYE_ADMIN_HOST, SORYE_EXTRA_HOSTS)', changedBy: deployer, sensitivity: 'public', applies: 'restart', consoleHref: '/admin', source: 'apps/hub/lib/admin/hosts.ts' },
      { key: 'workspace.ownerGates', label: 'Owner-only actions (workspace settings, site page, products)', status: 'constant', scope: 'workspace', store: 'Hub source', changedBy: release, sensitivity: 'internal', applies: 'release', source: 'apps/hub/app/api/backend/actions/batch/route.ts' },
    ],
    gaps: ['Only Google sign-in.', 'Member invitations are not implemented (memberIds is not applied by workspace updates).', 'Administrator list is not editable from the console; it is a deployment input by design.'],
  },
  {
    id: 'platform.workspaces', kind: 'platform', title: 'Workspaces and plans', summary: 'App selection, profile, plans.',
    settings: [
      { key: 'workspace.selectedAppIds', label: 'Selected apps and connected apps (plan-capped)', status: 'owner-app', scope: 'workspace', store: 'Hub store.json / Postgres', changedBy: member, sensitivity: 'internal', applies: 'next-request', source: 'apps/hub/app/api/workspace/route.ts' },
      rodrigoFamily('workspace.settings', 'Name, locale, timezone', 'workspace.settings', owner),
      { key: 'plans', label: 'Plan limits (free 2/1, starter 5/3, pro 12/10, enterprise 999/999)', status: 'constant', scope: 'platform', store: 'packages/types/src/subscription.ts', changedBy: release, sensitivity: 'public', applies: 'release', consoleHref: '/admin/workspaces', source: 'packages/types/src/subscription.ts' },
    ],
    gaps: ['No self-service billing.'],
  },
  {
    id: 'platform.infrastructure', kind: 'platform', title: 'Persistence, delivery and telemetry', summary: 'Stores, remotes, workers, telemetry, MCP.',
    settings: [
      { key: 'STORE_DRIVER', label: 'Hub store driver (json or postgres)', status: 'deployment', scope: 'deployment', store: 'Environment', changedBy: deployer, sensitivity: 'secret', applies: 'restart', consoleHref: '/admin/integrations', source: 'apps/hub/lib/env.ts' },
      { key: 'RODRIGO_*', label: 'Rodrigo URL and signing key', status: 'deployment', scope: 'deployment', store: 'Environment / secret file', changedBy: deployer, sensitivity: 'secret', applies: 'restart', consoleHref: '/admin/releases', source: 'apps/hub/lib/rodrigo/service-client.ts' },
      { key: 'PLATFORM_CONFIG_POLL_MS', label: 'Configuration poll interval (2–300 s, default 15 s)', status: 'deployment', scope: 'deployment', store: 'Environment', changedBy: deployer, sensitivity: 'public', applies: 'restart', consoleHref: '/admin/releases', source: 'apps/hub/lib/platform-config/watcher.ts' },
      { key: 'SENTRY_*', label: 'Server, browser and remote telemetry', status: 'deployment', scope: 'deployment', store: 'Environment / build input', changedBy: deployer, sensitivity: 'internal', applies: 'rebuild', consoleHref: '/admin/integrations', source: '.env.example' },
      { key: 'mcp.tools', label: 'MCP tool list, confirmation and admin gates', status: 'constant', scope: 'platform', store: 'Hub source', changedBy: release, sensitivity: 'internal', applies: 'release', source: 'apps/hub/lib/mcp/tools.ts' },
    ],
    gaps: ['JSON store mode runs webhook jobs inline rather than in the relay worker.', 'Release promotion and image tags are not controlled from the console.'],
  },
];

export function settingsArea(id: string): SettingsArea | undefined {
  return SETTINGS_INVENTORY.find((area) => area.id === id);
}

const STATUS_TEXT: Record<SettingStatus, string> = {
  console: 'Console (audited)',
  'owner-app': 'In the owning app',
  'read-only': 'Read-only',
  deployment: 'Deployment input',
  constant: 'Code constant',
  'not-implemented': 'Not implemented',
};

export const settingStatusText = (status: SettingStatus): string => STATUS_TEXT[status];

const cell = (text: string) => text.replace(/\|/g, '\\|');

/** Source of docs/admin/SETTINGS-MATRIX.md (`pnpm --filter @sorye/hub docs:settings-matrix`). */
export function renderSettingsMatrix(): string {
  const lines = [
    '# Settings matrix',
    '',
    'Generated from `apps/hub/lib/admin/settings-inventory.ts` by `pnpm --filter @sorye/hub docs:settings-matrix`. Do not edit by hand; `test:admin` fails when this file and the inventory differ.',
    '',
    'The administration console shows the same inventory under **Applications**. Values are never listed here, only where each setting lives and who may change it.',
    '',
    '| Status | Meaning |',
    '| --- | --- |',
    '| Console (audited) | Changed at admin.sorye.app with revision checks and an audit row. |',
    '| In the owning app | Changed by workspace members or owners inside the app; the console links there or shows it read-only. |',
    '| Read-only | Observable, with no write path. |',
    '| Deployment input | Environment variable, secret file or build input; changed by redeploying. |',
    '| Code constant | Changed by a code release. |',
    '| Not implemented | The capability does not exist. |',
    '',
  ];
  for (const area of SETTINGS_INVENTORY) {
    lines.push(`## ${area.title} (\`${area.id}\`)`, '', area.summary, '');
    lines.push('| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const s of area.settings) {
      lines.push(`| ${cell(s.label)} (\`${s.key}\`) | ${STATUS_TEXT[s.status]} | ${s.scope} | ${cell(s.store)} | ${cell(s.changedBy)} | ${s.sensitivity} | ${s.applies} | \`${s.source}\` |`);
    }
    lines.push('');
    if (area.gaps.length) {
      lines.push('Gaps:', '', ...area.gaps.map((gap) => `- ${gap}`), '');
    }
  }
  return lines.join('\n');
}
