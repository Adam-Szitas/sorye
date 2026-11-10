# Agent handoff: Sorye administration console

Implement a secure, production-oriented administration console at `https://admin.sorye.app`, while keeping `https://sorye.app` as the customer workspace Hub. Consolidate existing administration capabilities and establish a reliable configuration system. Deliver working code, deployment files, tests and accurate documentation, rather than only a design or mock dashboard.

## Repository context and working rules

- Sorye repository: `D:\projects\sorye`. Rodrigo backend: independent repository `D:\projects\rodrigo`. Inspect both worktrees before changing anything and preserve existing changes. Read each repository's `AGENTS.md` and applicable nested guidance.
- In Sorye, read `docs/AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/HUB-RODRIGO-BOUNDARY.md`, `docs/RODRIGO-DATA-CONTRACT.md`, `docs/apps/APPS.md`, `docs/APP-LANDINGS.md`, `docs/README-STEERING.md`, and both `docs/APP-BEHAVIOR-TREE` formats. Inspect current source; documentation describes a partial migration and can contain historical sections.
- Use the required modern-web-guidance skill before frontend work. Follow repository skills and contributor rules. Delegate only if the applicable session instructions permit it.
- Performance, reliability and modularity take priority. Measure changes where claims depend on concurrency, load or failure behavior.
- Recent uncommitted work may already include the OCR worker image/Compose registration, gateway upload fix, publication retry helpers, behavior-map changes, and Rodrigo release/documentation/test fixes. Preserve and build on those changes; do not recreate or revert them.
- No automatic production deployment, image promotion, credential rotation, destructive migration or live database changes. Prepare reviewable artifacts and validate with disposable infrastructure. Never print real credentials.

## Required architecture

Use this browser/service boundary:

```text
sorye.app             -> customer Hub pages and authorized APIs
admin.sorye.app       -> dedicated admin pages and authorized Hub APIs
Hub                  -> signed, versioned Rodrigo service contracts
Rodrigo              -> supported domain services and configured providers
```

Initially implement the admin UI as modular Hub-owned routes, for example `/admin`, exposed through a dedicated hostname gateway. This is an administration surface of Hub, not a second workspace OS. Reuse domain services and existing controls instead of copying their business logic. Keep the code organized so the frontend can later become independently deployable.

Do not create another independently writing Hub instance as a shortcut: existing file-backed/process-local state needs explicit ownership and synchronization before multiple writers are safe. Browser code must not call Rodrigo, databases, Docker sockets or secret stores directly. Apps must not import one another. Rodrigo source and deployment remain in its own repository.

Make exact-host routing explicit. `admin.sorye.app/` should open the console after administrator authentication, retain the admin hostname through login/callback/reload, and never fall through to a catalog landing page or customer launcher. Preserve current public introductions, published Site pages, embeds and app-subdomain routing. Define whether `/admin` on the customer hostname redirects or returns an access-controlled response; protect the route independently of that choice.

The admin domain is a platform surface, not a customer-selectable paid app. Reuse Operator capabilities without adding another plan slot. If catalog behavior or Operator navigation changes, update the catalog and associated documentation consistently. Follow the existing shared shell/standalone chrome conventions; do not add duplicate product navbars.

## Establish the actual baseline first

Inspect at least:

- `packages/types/src/apps.ts`: all catalog IDs, slugs, administrator-only flags and frontend kinds. The DevKit catalog ID is `devtools`, while its slug/remote name is `devkit`.
- `apps/hub/middleware.ts`, `auth.config.ts`, `lib/ensure-user.ts`, `lib/platform-admin.ts`.
- `components/app-operator.tsx`, `lib/operator/**`, `/api/operator`, `/api/operator/plan`, `/api/operator/notices`.
- `/api/admin/llm`, `/api/admin/llm/action`, `/api/llm/preferences`, `lib/llm-control.ts`, OCR worker and GPU/model code.
- `/api/backend/capabilities`, `/api/backend/topology`, and the signed Rodrigo clients/contracts.
- `/api/admin/subscription`: legacy shared-secret authentication is distinct from session-based platform-admin authentication. Never put this shared secret in the browser.
- Workspace, team, storage, events, Relay/storage, Mail/accounts, embed/widget and per-app APIs.
- `.env.example`, actual server environment readers, shared DTOs, app stores, frontend preference owners and security limits. An environment-file comment is not proof of implemented behavior.
- `deploy/`, `.forgejo/workflows/`, existing Dockerfiles, deployment verification and Rodrigo's authoritative `contracts/`.

Create a reviewed settings inventory before wiring editors. For every field record: exact key, source file/API, current support status, owner, scope, type, validation, default, override precedence, sensitivity, persistence, application timing, affected consumers, and required permission. Classify support as existing, newly implemented, deployment-managed, read-only, or deferred. A hard-coded constant is not already a configurable setting.

## Console experience

Provide clear sections for Overview; Workspaces and access; Applications; AI and workers; Integrations and storage; Releases and infrastructure; Configuration history.

- Overview: dependency health, stale workers, configuration drift, errors, versions and unsupported/unconfigured capabilities. A dependency outage must not make the entire console unusable.
- Workspaces: explicit target workspace, current plan/app entitlements, supported membership controls, scheduled changes and notices. Never silently operate on the administrator's active personal workspace.
- Application detail: app identity, delivery kind, installed/build version where verifiable, health, configuration, effective values, ownership and integration status.
- Every setting should state its scope and when a change takes effect. Display saved, pending application, applied, restart required, failed or unknown accurately.
- Keep product text plain. Place deep technical diagnostics in appropriate details panels. Empty, unavailable and forbidden states must be distinct.

## Platform-wide settings inventory

Implement existing safe controls and the new configuration foundations below. Deployment-managed values need status and documented change procedures; do not pretend they are live-editable.

| Area | Settings and controls to cover |
|---|---|
| Authentication | Google OAuth configured status; allowed callback/admin origin configuration; session policy; platform administrator allowlist/bootstrap policy. `AUTH_SECRET`, OAuth secrets, `AUTH_URL` and trusted-host behavior are deployment/security configuration. Production must never allow `AUTH_DEV_BYPASS`. |
| Authorization | Platform administrator access versus workspace ownership/member access; per-operation authorization; explicit target-workspace access for administration. Preserve `ADMIN_EMAILS` as a controlled bootstrap mechanism until a reviewed durable role model exists. Prevent self-lockout and privilege escalation. |
| Workspace policy | Workspace name/profile, enabled app IDs, supported connected-app configuration, membership/roles, subscription tier, app/connection limits and scheduled plan effective date/note. Verify each existing mutation's ownership and permission. |
| Plans and pricing | Existing plan definitions, yearly app running-cost data, limits and current assignments. Assignment and scheduling already have controls; changing plan definitions/prices is source-managed until a versioned policy contract is implemented. Do not imply that Stripe billing exists. |
| Events and notifications | Workspace event opt-in, delivery to Messenger events, supported per-source routing, operator notice message/audience/start/end/active fields. Keep personal notice dismissal and user notification state private. |
| Shared AI | Provider, base URL, model, context length, output-token cap, free-VRAM reserve, GPU index, paused state, supported pause/resume/stop controls. Verify application to the actual worker/model process. |
| Persistence | Hub `STORE_DRIVER`, database configured status and connection probes; supported workspace PostgreSQL settings; Drive object-store driver/bucket/region/endpoint/path-style and credentials status. Schema/driver changes require migration procedures, not an immediate toggle. |
| Rodrigo | Backend origin, signing key ID/key-file configured status, contract/capability/topology information, compatible releases/provider readiness. Keep private keys server-side. Legacy document ownership mappings are a migration mechanism, not an ordinary settings dropdown. |
| Frontend delivery | Each remote's configured URL and corresponding `NEXT_PUBLIC_*_REMOTE` build input; remote/build identity; gateway upstream and deployment digest status. Build inputs require rebuilding Hub; do not label a saved URL as applied at runtime. If runtime discovery is introduced, define versioned manifests, trust, invalidation and rollback explicitly. |
| Telemetry | Server/browser/remote telemetry configured status, environment, release and sample rates. Distinguish server `SENTRY_*`, browser `NEXT_PUBLIC_SENTRY_*` and remote `VITE_SENTRY_*`. Upload tokens and other secrets remain server-side. Preserve content redaction. |
| Workers | OCR/Relay worker readiness where implemented, heartbeat, queue counts, oldest queued age, running/failed jobs and bounded diagnostics. Retry/cancel/drain controls require explicit existing or newly implemented job authorization and idempotency. Do not fabricate a general Rodrigo jobs API. |
| Deployment | Immutable Hub/app/worker image references, compatible Hub/Rodrigo contract versions, health, resource limits, volume/mount identity and desired/applied configuration. DNS/TLS, image promotion, migrations, backups and key rotation remain controlled deployment operations unless a narrowly authorized service contract is added. |
| MCP | Existing tool availability, app/role checks and confirmation requirements. Provider settings belong to their existing owner. New global tool policy is a proposed feature requiring a contract; never silently remove destructive-action confirmation. |

## Per-app settings and boundaries

Cover all 21 current catalog apps. The fields below are an implementation inventory, not a claim that all controls already exist. For each row verify source and DTOs; expose existing settings, implement agreed configuration policy, and mark remaining candidates explicitly. Distinguish settings from documents or content editing. Common app enablement, delivery/version status and authorized policy apply across apps where relevant.

| App | Existing surfaces or values to inspect and consolidate | Additional configuration candidates and boundaries |
|---|---|---|
| Catalog (`catalog`) | Catalog entries/categories, app visibility, plan entitlements, yearly running-cost information, included/admin/presentation flags. | Catalog metadata is currently code-owned. New runtime availability/maintenance controls must enforce policy at APIs as well as launchers. Preserve always-available and admin-only rules. |
| Contact (`contact`) | Public presentation copy, supported languages, links, existing contact journey. | Contact details/content editing is a proposed CMS capability unless a persisted contract exists. Preserve anonymous access; never expose workspace data or invent an email-delivery service. |
| Dashboard (`dashboard`) | Workspace event opt-in, delivery to Messenger events, existing connection/settings surfaces and metrics. | Default widgets/date ranges/refresh controls only if implemented. User layout belongs to the user/app; do not turn private layout state into platform settings. |
| Notes (`notes`) | Enabled access, Rodrigo integration status, workspace-scoped persistence and supported limits. | Note count/title/body policy or default editor preferences are new controls if currently constants/local state. Notes themselves are user content, not global configuration. Preserve queued writes and conflict behavior. |
| Calendar (`calendar`) | Enabled access, event integrations, workspace-scoped persistence and supported event bounds. | Timezone, week-start, default view and calendar defaults require verifying current preference owners. Do not promise external calendar synchronization. Events remain content. |
| Tasks (`tasks`) | Enabled access, workspace board ownership, status contract and task-image attachment policy. | Board templates, statuses, priority defaults and attachment limits need validated app-specific contracts before administrative editing. Preserve existing boards and Rodrigo revision checks. |
| Relay (`relay`) | `sources`, channels (`kind`, label, enabled, destination), routes (`sourceAppId`, `channelId`, enabled), quiet-hours enabled/start/end; configured storage connections and supported tests. | Distinguish live Messenger/webhook delivery from queued or unsupported email/WhatsApp paths. Protect endpoint changes against SSRF. Storage credentials are write-only; worker retry/retention policies require implementation if currently constants. |
| Storefront (`storefront`) | App access; products/enquiry integration status; current product and enquiry behavior. | Currency/shop presentation/catalog policies only where supported. Product editing is domain content. No checkout, payment, inventory or order-status workflow may be advertised without a real contract. |
| Site (`site`) | Page publishing status, slug/visibility, supported section/template behavior and published-read path. | Page text/blocks are content. Custom domains, themes, SEO defaults, publishing approval or scheduling are proposed unless implemented. Preserve anonymous published reads and 404 for unpublished/unknown slugs. |
| DevKit (`devtools`, slug `devkit`) | Embed widget creation/configuration, allowed origins, keys and connection limits; supported app/mode options. | Widget/key lifecycle must use existing authorization and origin checks. No raw signing secrets; display generated credentials only under a deliberate existing issuance flow. Preserve catalog ID/slug distinction. |
| Protocolio (`protocolio`) | `PROTOCOLIO_API_URL`, production service-token configured status, renderer health, authenticated generate/validate bridge, current template behavior. | Endpoint/token changes are server/deployment settings unless a validated service configuration contract exists. Templates and drafts remain app content; drafts retain workspace ownership. Never use development-token or direct-engine fallbacks in production. |
| Canvas (`canvas`) | Board access, current persistence, realtime dependency health and configured bounds. | Collaboration/default-board settings are candidates, not assumed APIs. Boards and private viewport/selection state remain app-owned. Preserve workspace/channel authorization and existing invalidation behavior. |
| Messenger (`messenger`) | Channel visibility/membership, workspace-open channels, text/channel integration status and notification rules. | Channel administration must respect membership. Retention/moderation/attachments/reactions/read receipts require explicit implemented contracts; do not re-enable uncovered writers. No global administrator access to private message bodies by default. |
| Mail (`mail`) | Account provider/label/email/username and supported IMAP/SMTP host/port/security fields; connection test/sync status; profile personal-email/`notifyMessenger` preferences where authorized. | Passwords are write-only and user/workspace-scoped. Gmail/Outlook presets and host validation remain authoritative. Global server settings must not expose users' mailbox credentials. Quotas/sync cadence are editable only with backing enforcement. This is not public MX hosting. |
| Drive (`files`) | File-store driver and S3 bucket/region/endpoint/path-style; credentials configured status; byte/metadata ownership and current size/MIME constraints. | Upload/storage quotas, retention and permitted types are policy candidates requiring server enforcement and usage accounting. File names and bytes are content. No automatic bucket move, data deletion or public-access change. |
| SUSM (`susm`) | Catalog iframe URL, embedding policy and external availability. | URL changes are code/deployment-managed until supported. External credentials, business configuration and data belong to SUSM; show links/status, not invented internal controls. |
| ESPM (`espm`) | Catalog iframe URL, embedding policy and external availability. | Same external-service boundary as SUSM. Preserve separate sign-in; do not ingest credentials into Sorye administration. |
| OCR (`ocr`) | Shared LLM fields above; GPU guard deployment flag; per-user execution target, WebGPU power preference/model ID and host GPU preference; 64 MiB PDF/500-page/current analysis limits; queue/worker status. | Keep user GPU preferences under user ownership. Changes to global policy need enforcement in both Hub and worker. Gateway accepts 65 MiB including multipart overhead. Queue concurrency/capacity/retry controls must match the real queue and measured resource limits. Never expose arbitrary shell/PID/GPU execution. |
| Studio (`studio`) | App access, supported 3D formats, current upload/render constraints and existing overload protection. | Model/viewer limits, defaults and GPU behavior require source verification. Viewer camera/selection stays private. Do not promise model conversion or server rendering. |
| Reports (`reports`) | Admin-only access, supported event-chart date range/grouping/filter controls. | These may be view filters rather than durable settings. Retention, export policy and aggregation configuration require implemented backend support. Keep Reports' workspace scope distinct from platform-wide Operator metrics. |
| Operator (`operator`) | Platform health/usage/app loads/errors; workspace plan assignment with effective date/note; notice message/audience/start/end/active. | Reuse these services in the console. Preserve platform-admin gating and count/metadata-only diagnostics. Do not duplicate Operator persistence or grant ordinary workspace owners access. |

Inspect all existing security-limit constants before introducing controls. Setting a lower future-write limit must not corrupt or hide existing valid records. Do not create cosmetic settings whose values are never consumed.

## Configuration correctness

Define explicit scopes: deployment, platform, workspace, user and app-private UI. Administrators manage platform policy; members retain permitted preferences. Overrides must have documented precedence, bounds and an effective-value explanation. A workspace setting must never modify another workspace.

Introduce typed versioned configuration contracts and durable storage appropriate to the current ownership boundary. Intended backend ownership is Rodrigo. Do not establish a new permanent Hub domain store merely for convenience. If Rodrigo needs a configuration/audit contract, implement it in its own authoritative contracts and service, then update Sorye's reviewed snapshot/DTOs and compatibility tests. Define a bounded MVP; unrelated missing backend domains are not prerequisites to invent.

For configuration writes:

1. Authenticate and authorize the operation and scope server-side.
2. Validate bounded input and service destinations, including redirect/DNS/SSRF behavior where relevant.
3. Enforce an expected revision/ETag to reject stale writes.
4. Atomically persist the change and its audit event, with idempotency/retry behavior.
5. Propagate a version to affected consumers. Observe their applied version or report unknown/restart-required; do not infer application merely from database success.
6. Support explicit conflict/failure/recovery states and non-destructive rollback of configuration. Image rollback is not data rollback.

Resolve the existing LLM control process-local cache before promising central controls: Hub and the OCR worker must observe supported changes coherently after restart and during operation. Define pause versus cancel versus unload semantics; a Hub-local abort must not be presented as stopping an independently running worker. Keep propagation bounded and coalesced; avoid refetching all configuration on every model request.

## Security requirements

- Require authenticated platform-administrator authorization on every admin page/API. A subdomain or hidden menu is not authorization. Retain least-privilege scope checks when forwarding to Rodrigo; do not sign arbitrary caller-selected roles/workspaces.
- Use a host-scoped admin session, secure cookie settings and explicit OAuth callback handling. Do not broaden cookies to `.sorye.app` for convenience. Check actual Auth.js behavior, trusted forwarded hosts and local-development rules.
- Restrict trusted ingress hosts and forwarding headers. Unknown/spoofed hosts must not become OAuth or redirect origins. Define direct-backend access protection.
- Enforce mutation-origin/CSRF protection; sibling subdomains are not isolated by SameSite alone. Protect legacy mutation routes too when they remain reachable.
- Secrets are write-only or secret references. Return configured status and safe metadata, never stored passwords, connection strings, tokens or private keys. Redact audit before/after values, logs, errors and telemetry. Explain any permitted one-time credential issuance separately.
- Provide audit actor/time/target/action/revision/outcome and correlation IDs without private app contents. Do not permit ordinary settings edits to disable authorization or auditing.
- Rate-limit sensitive probes/mutations; bound request size and probe duration. No arbitrary shell commands, Docker socket mounts, unrestricted proxy URLs or raw SQL in the console.
- Critical role, key, database, deployment and deletion actions need an explicit reviewed workflow, recent authentication where supported, clear impact and recovery. Do not add nonfunctional confirmation dialogs as a substitute for authorization.

## Deployment deliverables

- Add a dedicated admin hostname gateway/Compose registration using the existing deployment approach. Correctly route `/`, admin pages, static assets, auth callbacks and same-origin APIs. Restrict the allowed route surface deliberately.
- Supply DNS/TLS and exact ingress configuration examples for `admin.sorye.app`; distinguish examples from provisioned infrastructure. Preserve `sorye.app` and every existing app hostname.
- Document the Google OAuth callback, target-owned environment/secrets, Hub upstream, image digest, loopback binding, health/resource limits and rollback steps.
- Preserve current immutable publication/resume helpers, same-commit concurrency, separate app/worker releases, Hub persistent volume and independent Rodrigo release. Add the admin artifact to publishing only if it needs a separate image.
- Gateways must not gain persistent domain state. Do not remove existing Hub storage until a verified ownership transfer exists.
- Rodrigo currently lacks target identity bootstrap, generic jobs, general durable event delivery/external orchestration and large-blob ownership. Keep these explicit; do not claim topology discovery proves those capabilities exist.

## Verification and acceptance

Use meaningful tests for trust boundaries and state transitions, not snapshots of implementation details.

- Host routing: customer/admin/app/unknown hosts, login redirects/callbacks, repeated navigation and reload, static/remote assets and intended version resolution.
- Authorization: anonymous, regular member, workspace owner, platform admin, revoked admin; direct page/API access; unauthorized workspace targets; alternate legacy endpoints.
- Session/CSRF: host-scoped cookies, sibling-origin mutation rejection, forged forwarded hosts, redirect validation and login continuity.
- Configuration: read/write persistence, concurrent administrators, stale revision conflict, invalid values, audit atomicity, restart, dependency outage, retry/idempotency and explicit recovery. Prove no silent fallback/dual writer.
- Propagation: actual Hub plus separately running worker observe supported version changes; pause/resume reaches the intended process; restart-required fields remain honest; worker outage shows pending/unknown rather than false success.
- Privacy: no secrets or app content in API responses, audit events, browser bundles, errors or logs. Test write-only updates and redaction.
- Performance: bounded health/config polling, hidden/offline pause, coalescing, query/page limits and isolation from customer request latency. Record measurements when claiming improvement.
- UI: keyboard operation, labels/errors/focus, responsive tables/forms, loading/empty/forbidden/unavailable states, and existing locale conventions.
- Validate all affected Compose combinations; build changed images; run relevant TypeScript/Rust checks, existing Hub/Rodrigo compatibility tests and disposable provider/failure checks where contracts change. Clean up only resources created for these tests.
- Update both behavior-map formats, architecture/security/deployment references, app documentation and landing copy review according to repository rules. Keep current versus target behavior explicit.

Deliver a settings matrix covering every catalog app, working admin console, typed APIs/contracts and persistence for its supported controls, deployment artifacts, operator runbook, and verification report. Implement in reviewable increments: establish secure routing/access first, consolidate existing controls second, then durable configuration/audit and real propagation. Continue through validation; do not stop after planning. If a capability cannot safely be implemented within the existing contracts, document the exact gap and keep it visibly unavailable instead of presenting a successful editor.

Your final handoff must state what works, what remains read-only/deployment-managed/deferred, tests and measurements actually run, required environment actions, known risks and rollback procedure. Do not claim production readiness from YAML validation alone.
