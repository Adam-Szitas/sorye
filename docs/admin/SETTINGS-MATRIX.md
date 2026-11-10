# Settings matrix

Generated from `apps/hub/lib/admin/settings-inventory.ts` by `pnpm --filter @sorye/hub docs:settings-matrix`. Do not edit by hand; `test:admin` fails when this file and the inventory differ.

The administration console shows the same inventory under **Applications**. Values are never listed here, only where each setting lives and who may change it.

| Status | Meaning |
| --- | --- |
| Console (audited) | Changed at admin.sorye.app with revision checks and an audit row. |
| In the owning app | Changed by workspace members or owners inside the app; the console links there or shows it read-only. |
| Read-only | Observable, with no write path. |
| Deployment input | Environment variable, secret file or build input; changed by redeploying. |
| Code constant | Changed by a code release. |
| Not implemented | The capability does not exist. |

## Catalog (`catalog`)

Always-available app list; reads APP_CATALOG at runtime.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Catalog entries and descriptions (`catalog.entries`) | Code constant | platform | packages/types/src/apps.ts | Code release | public | release | `packages/types/src/apps.ts` |

Gaps:

- No catalog-specific settings; it is pinned for every workspace and cannot be turned off.

## Contact (`contact`)

Public presentation page at /contact; not part of customer chrome.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Page content (`contact.page`) | Code constant | platform | Hub source | Code release | public | release | `apps/hub/app/contact` |

Gaps:

- No configurable content or form destination.

## Dashboard (`dashboard`)

Workspace overview, event opt-in, analytics and personal GPU preference.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remote entry URL (`dashboard.remoteEntry`) | Deployment input | deployment | NEXT_PUBLIC_DASHBOARD_REMOTE | Deployer (environment, redeploy) | public | rebuild | `apps/hub/lib/mf-remotes.ts` |
| Workspace event bus opt-in (`events.enabled`) | In the owning app | workspace | Hub event-settings.json / Postgres | Workspace member (in the app) | internal | next-request | `apps/hub/app/api/events/route.ts` |
| Deliver events to Messenger (`events.deliverToMessengerEvents`) | In the owning app | workspace | Hub event-settings.json / Postgres | Workspace member (in the app) | internal | next-request | `apps/hub/app/api/events/route.ts` |
| Personal GPU preference (target, WebGPU model, host GPU index) (`llm.userGpuPreference`) | In the owning app | user | Hub llm-control.json userGpuPreferences | Signed-in user | internal | next-request | `apps/hub/app/api/llm/preferences/route.ts` |
| Analytics snapshot (`analytics`) | Read-only | workspace | Derived | n/a | internal | n/a | `apps/hub/app/api/analytics/route.ts` |

Gaps:

- The shared AI engine moved to the administration console; Dashboard only shows a pointer to it.
- No persisted per-widget layout.

## Notes (`notes`)

Workspace notes stored in Rodrigo.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remote entry URL (`notes.remoteEntry`) | Deployment input | deployment | NEXT_PUBLIC_NOTES_REMOTE | Deployer (environment, redeploy) | public | rebuild | `apps/hub/lib/mf-remotes.ts` |
| Notes (title ≤500, body ≤100000) (`notes.note`) | In the owning app | workspace | Rodrigo notes.note | Workspace member (in the app) | internal | next-request | `apps/hub/lib/rodrigo/action-validation.ts` |

Gaps:

- No per-note sharing or visibility settings.

## Calendar (`calendar`)

Workspace events stored in Rodrigo.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remote entry URL (`calendar.remoteEntry`) | Deployment input | deployment | NEXT_PUBLIC_CALENDAR_REMOTE | Deployer (environment, redeploy) | public | rebuild | `apps/hub/lib/mf-remotes.ts` |
| Events (timed, all-day, multi-date ≤366 days) (`calendar.event`) | In the owning app | workspace | Rodrigo calendar.event | Workspace member (in the app) | internal | next-request | `apps/hub/lib/rodrigo/action-validation.ts` |

Gaps:

- Timezone comes from the workspace profile; no per-calendar timezone.

## Relay (`relay`)

Routes app events to channels.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remote entry URL (`relay.remoteEntry`) | Deployment input | deployment | NEXT_PUBLIC_RELAY_REMOTE | Deployer (environment, redeploy) | public | rebuild | `apps/hub/lib/mf-remotes.ts` |
| Enabled sources (`relay.sources`) | In the owning app | workspace | Hub relay.json / Postgres | Workspace member (in the app) | internal | next-request | `apps/hub/app/api/relay/route.ts` |
| Channels (webhook URLs are SSRF-checked) (`relay.channels`) | In the owning app | workspace | Hub relay.json / Postgres | Workspace member (in the app) | internal | next-request | `apps/hub/lib/relay.ts` |
| Source-to-channel routes (`relay.routes`) | In the owning app | workspace | Hub relay.json / Postgres | Workspace member (in the app) | internal | next-request | `apps/hub/app/api/relay/route.ts` |
| Quiet hours (default off, 22:00–07:00) (`relay.quietHours`) | In the owning app | workspace | Hub relay.json / Postgres | Workspace member (in the app) | internal | next-request | `apps/hub/lib/relay.ts` |
| Cloud storage connections (credentials encrypted) (`relay.storages`) | In the owning app | workspace | Hub relay-storages.json (STORAGE_SECRET_KEY) | Platform administrator (in Relay) | secret | next-request | `apps/hub/app/api/relay/storages/route.ts` |

Gaps:

- Email and WhatsApp channels queue messages but do not deliver.
- Rodrigo relay.config exists in the contract but the Relay UI still writes relay.json.

## Storefront (`storefront`)

Products and order requests.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Products (`storefront.product`) | In the owning app | workspace | Rodrigo storefront.product | Workspace owner (in the app) | internal | next-request | `apps/hub/lib/rodrigo/action-validation.ts` |
| Order requests (`storefront.order`) | In the owning app | workspace | Rodrigo storefront.order | Workspace member (in the app) | internal | next-request | `apps/hub/lib/rodrigo/action-validation.ts` |

Gaps:

- No checkout or payment provider (Stripe is not implemented).

## Site (`site`)

Public workspace page at /s/<slug>.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Page slug, title, published flag, blocks (≤100) (`site.page`) | In the owning app | workspace | Rodrigo site.page | Workspace owner (in the app) | internal | next-request | `apps/hub/lib/rodrigo/action-validation.ts` |

Gaps:

- No custom domains.

## DevKit (`devtools`)

Embed widgets and developer tooling.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remote entry URL (`devtools.remoteEntry`) | Deployment input | deployment | NEXT_PUBLIC_DEVKIT_REMOTE | Deployer (environment, redeploy) | public | rebuild | `apps/hub/lib/mf-remotes.ts` |
| Embed widgets (name, allowed origins, enabled apps) (`embed.widgets`) | In the owning app | workspace | Hub embed.json / Postgres | Workspace member (in the app) | internal | next-request | `apps/hub/app/api/embed/widgets/route.ts` |
| Widget API key (shown once, then only a hint) (`embed.apiKey`) | In the owning app | workspace | Hub embed store (hashed) | Workspace member (in the app) | secret | next-request | `apps/hub/lib/store/embed-json.ts` |

## Protocolio (`protocolio`)

Templates and PDF generation through the Protocolio renderer.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remote entry URL (`protocolio.remoteEntry`) | Deployment input | deployment | NEXT_PUBLIC_PROTOCOLIO_REMOTE | Deployer (environment, redeploy) | public | rebuild | `apps/hub/lib/mf-remotes.ts` |
| Template artifacts (`protocolio.artifact`) | In the owning app | workspace | Rodrigo protocolio.artifact | Workspace member (in the app) | internal | next-request | `apps/hub/lib/rodrigo/action-validation.ts` |
| Renderer URL (`PROTOCOLIO_API_URL`) | Deployment input | deployment | Environment | Deployer (environment, redeploy) | internal | restart | `apps/hub/lib/protocolio-bridge.ts` |
| Renderer service token (`PROTOCOLIO_SERVICE_TOKEN`) | Deployment input | deployment | Environment / secret file | Deployer (environment, redeploy) | secret | restart | `apps/hub/lib/protocolio-bridge.ts` |

Gaps:

- No per-workspace renderer credentials.

## Canvas (`canvas`)

Boards stored in Rodrigo.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remote entry URL (`canvas.remoteEntry`) | Deployment input | deployment | NEXT_PUBLIC_CANVAS_REMOTE | Deployer (environment, redeploy) | public | rebuild | `apps/hub/lib/mf-remotes.ts` |
| Boards (title ≤200) (`canvas.board`) | In the owning app | workspace | Rodrigo canvas.board | Workspace member (in the app) | internal | next-request | `apps/hub/lib/rodrigo/action-validation.ts` |

Gaps:

- No per-board access control beyond workspace membership.

## Tasks (`tasks`)

Task board stored in Rodrigo.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remote entry URL (`tasks.remoteEntry`) | Deployment input | deployment | NEXT_PUBLIC_TASKS_REMOTE | Deployer (environment, redeploy) | public | rebuild | `apps/hub/lib/mf-remotes.ts` |
| Board statuses (≤30) and tasks (≤500) (`tasks.taskBoard`) | In the owning app | workspace | Rodrigo tasks.taskBoard | Workspace member (in the app) | internal | next-request | `apps/hub/lib/rodrigo/action-validation.ts` |

Gaps:

- No task notification preferences.

## Messenger (`messenger`)

Channels and messages stored in Rodrigo.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remote entry URL (`messenger.remoteEntry`) | Deployment input | deployment | NEXT_PUBLIC_MESSENGER_REMOTE | Deployer (environment, redeploy) | public | rebuild | `apps/hub/lib/mf-remotes.ts` |
| Channels, messages, reactions (`messenger.*`) | In the owning app | workspace | Rodrigo messenger.* | Workspace member (in the app) | internal | next-request | `apps/hub/lib/rodrigo/action-validation.ts` |

Gaps:

- No retention policy or encryption settings.

## Mail (`mail`)

Personal mailbox profile and connected IMAP/SMTP accounts.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Personal email and Messenger notification (`mail.profile`) | In the owning app | user | Hub mail.json / Postgres | Signed-in user | internal | next-request | `apps/hub/app/api/mail/route.ts` |
| Connected accounts (≤8, passwords write-only) (`mail.accounts`) | In the owning app | user | Hub mail.json (encrypted) | Signed-in user | secret | next-request | `apps/hub/app/api/mail/accounts/route.ts` |
| Mail credential encryption key (`MAIL_SECRET_KEY`) | Deployment input | deployment | Environment | Deployer (environment, redeploy) | secret | restart | `apps/hub/lib/storage-crypto.ts` |

Gaps:

- Hub is not a public mail server; no workspace-wide SMTP settings.

## Drive (`files`)

Workspace files; blobs local or S3-compatible.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Upload limits (64 MB per file, 200 per workspace) (`files.limits`) | Code constant | platform | packages/types/src/files.ts | Code release | public | release | `packages/types/src/files.ts` |
| Blob driver and S3 settings (`FILE_STORE_DRIVER`) | Deployment input | deployment | Environment (FILE_S3_*) | Deployer (environment, redeploy) | secret | restart | `apps/hub/lib/file-blobs.ts` |
| Optional workspace Postgres connection (`workspace.storage`) | In the owning app | workspace | Hub workspace-storage.json (encrypted, hints only) | Workspace member (in the app) | secret | next-request | `apps/hub/app/api/workspace/storage/route.ts` |

Gaps:

- No per-folder permissions.

## SUSM (`susm`)

External site embedded by URL.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| External URL (`susm.url`) | Code constant | platform | packages/types/src/apps.ts | Code release | public | release | `packages/types/src/apps.ts` |

Gaps:

- No Hub-side settings; sign-in happens on the external site.

## ESPM (`espm`)

External site embedded by URL.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| External URL (`espm.url`) | Code constant | platform | packages/types/src/apps.ts | Code release | public | release | `packages/types/src/apps.ts` |

Gaps:

- No Hub-side settings.

## OCR (`ocr`)

Document analysis on the shared AI engine or the browser GPU.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remote entry URL (`ocr.remoteEntry`) | Deployment input | deployment | NEXT_PUBLIC_OCR_REMOTE | Deployer (environment, redeploy) | public | rebuild | `apps/hub/lib/mf-remotes.ts` |
| Shared AI engine (provider, URL, model, limits, GPU, paused) (`shared-ai`) | Console (audited) | platform | Rodrigo platform config (shared-ai) | Platform administrator (console, audited) | internal | propagated | `apps/hub/lib/admin/shared-ai.ts` |
| Stop Hub-local requests and unload the model (after pausing) (`shared-ai.stop`) | Console (audited) | platform | Hub process | Platform administrator (console, audited) | internal | next-request | `apps/hub/app/api/admin/llm/action/route.ts` |
| Bootstrap engine when no Rodrigo revision exists (`OCR_LLM_*`) | Deployment input | deployment | Environment | Deployer (environment, redeploy) | internal | restart | `apps/hub/lib/llm-control.ts` |
| Limits (64 MB PDF, 500 pages, 50 analyses) (`ocr.limits`) | Code constant | platform | Hub source | Code release | public | release | `apps/hub/lib/security-limits.ts` |
| Worker heartbeat file (`OCR_WORKER_HEALTH_FILE`) | Deployment input | deployment | Environment | Deployer (environment, redeploy) | internal | restart | `apps/hub/lib/workers/ocr-worker.ts` |

Gaps:

- No per-workspace model override.
- Stop does not cancel requests already running in the OCR worker; pause stops it from starting new ones.

## Studio (`studio`)

Media projects stored in Rodrigo; uploads go to Drive.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Remote entry URL (`studio.remoteEntry`) | Deployment input | deployment | NEXT_PUBLIC_STUDIO_REMOTE | Deployer (environment, redeploy) | public | rebuild | `apps/hub/lib/mf-remotes.ts` |
| Projects (name ≤200, asset refs ≤1000) (`studio.project`) | In the owning app | workspace | Rodrigo studio.project | Workspace member (in the app) | internal | next-request | `apps/hub/lib/rodrigo/action-validation.ts` |

Gaps:

- GPU monitor thresholds are fixed in code.

## Reports (`reports`)

Admin-only usage counts in the customer Hub.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Report window (7, 14, 30, 90 days) (`reports.range`) | Code constant | platform | packages/types/src/reports.ts | Code release | internal | release | `apps/hub/app/api/reports/route.ts` |

Gaps:

- No export.

## Operator (retired) (`operator`)

Removed from the customer Hub. Its health, plans, notices, usage and load views are now console sections.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Workspace plan (immediate or scheduled) (`workspace.subscriptionId`) | Console (audited) | workspace | Hub store.json / Postgres | Platform administrator (console, audited) | internal | next-request | `apps/hub/app/api/operator/plan/route.ts` |
| Platform notices (≤40, message ≤400) (`operator.notices`) | Console (audited) | platform | Hub operator-notices.json / Postgres | Platform administrator (console, audited) | public | next-request | `apps/hub/app/api/operator/notices/route.ts` |

Gaps:

- /apps/operator on the customer host redirects to the console.

## Authentication and access (`platform.access`)

Sign-in, administrator list and host separation.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Google OAuth client (callbacks for both hosts) (`AUTH_GOOGLE_ID`) | Deployment input | deployment | Environment | Deployer (environment, redeploy) | secret | restart | `apps/hub/lib/env.ts` |
| Session signing secret (`AUTH_SECRET`) | Deployment input | deployment | Environment | Deployer (environment, redeploy) | secret | restart | `apps/hub/lib/env.ts` |
| Platform administrators (production fails closed when empty) (`ADMIN_EMAILS`) | Deployment input | deployment | Environment | Deployer (environment, redeploy) | internal | restart | `apps/hub/lib/platform-admin.ts` |
| Admin and public hostnames (`SORYE_ADMIN_HOST`) | Deployment input | deployment | Environment (SORYE_PUBLIC_HOST, SORYE_ADMIN_HOST, SORYE_EXTRA_HOSTS) | Deployer (environment, redeploy) | public | restart | `apps/hub/lib/admin/hosts.ts` |
| Owner-only actions (workspace settings, site page, products) (`workspace.ownerGates`) | Code constant | workspace | Hub source | Code release | internal | release | `apps/hub/app/api/backend/actions/batch/route.ts` |

Gaps:

- Only Google sign-in.
- Member invitations are not implemented (memberIds is not applied by workspace updates).
- Administrator list is not editable from the console; it is a deployment input by design.

## Workspaces and plans (`platform.workspaces`)

App selection, profile, plans.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Selected apps and connected apps (plan-capped) (`workspace.selectedAppIds`) | In the owning app | workspace | Hub store.json / Postgres | Workspace member (in the app) | internal | next-request | `apps/hub/app/api/workspace/route.ts` |
| Name, locale, timezone (`workspace.settings`) | In the owning app | workspace | Rodrigo workspace.settings | Workspace owner (in the app) | internal | next-request | `apps/hub/lib/rodrigo/action-validation.ts` |
| Plan limits (free 2/1, starter 5/3, pro 12/10, enterprise 999/999) (`plans`) | Code constant | platform | packages/types/src/subscription.ts | Code release | public | release | `packages/types/src/subscription.ts` |

Gaps:

- No self-service billing.

## Persistence, delivery and telemetry (`platform.infrastructure`)

Stores, remotes, workers, telemetry, MCP.

| Setting | Status | Scope | Stored in | Changed by | Sensitivity | Applies | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hub store driver (json or postgres) (`STORE_DRIVER`) | Deployment input | deployment | Environment | Deployer (environment, redeploy) | secret | restart | `apps/hub/lib/env.ts` |
| Rodrigo URL and signing key (`RODRIGO_*`) | Deployment input | deployment | Environment / secret file | Deployer (environment, redeploy) | secret | restart | `apps/hub/lib/rodrigo/service-client.ts` |
| Configuration poll interval (2–300 s, default 15 s) (`PLATFORM_CONFIG_POLL_MS`) | Deployment input | deployment | Environment | Deployer (environment, redeploy) | public | restart | `apps/hub/lib/platform-config/watcher.ts` |
| Server, browser and remote telemetry (`SENTRY_*`) | Deployment input | deployment | Environment / build input | Deployer (environment, redeploy) | internal | rebuild | `.env.example` |
| MCP tool list, confirmation and admin gates (`mcp.tools`) | Code constant | platform | Hub source | Code release | internal | release | `apps/hub/lib/mcp/tools.ts` |

Gaps:

- JSON store mode runs webhook jobs inline rather than in the relay worker.
- Release promotion and image tags are not controlled from the console.
