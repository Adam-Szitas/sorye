# Admin console: status and handoff

Status of the work on [the admin console spec](ADMIN-CONSOLE-IMPLEMENTATION-PROMPT.md) as of 2026-11-10. **This is not production ready.** Nothing was committed, deployed, or applied to any database. Read this whole file before continuing.

## Done

The following works in code now. Hub typecheck passes. Browser and end-to-end checks have not been run (see Verification).

### Hostname routing and access (stage 1, mostly done)
- **`apps/hub/lib/admin/hosts.ts`** (new, Edge-safe). Classifies the request host as `customer`, `admin`, `app` (exact `<catalog slug>.<public host>`) or `unknown`. The host is the first `X-Forwarded-Host` value, or `Host` when that header is missing (Auth.js reads hosts the same way).
  - Settings: `SORYE_PUBLIC_HOST` (default `sorye.app`), `SORYE_ADMIN_HOST` (default `admin.<public host>` in production, `admin.localhost` in development), and `SORYE_EXTRA_HOSTS` (comma-separated customer aliases).
  - Production treats any other host as `unknown`. The exception is a loopback host with no forwarded header, which container healthchecks need. Development treats every host except the admin host as `customer`.
  - The file also defines: the admin route allowlist, the list of admin-only APIs, an exact-origin check for mutations (CSRF), and the `adminOrigin` / `customerOrigin` helpers.
- **`apps/hub/middleware.ts`** (rewritten on top of the existing logic):
  - Unknown hosts get a 421.
  - On the admin host:
    - `/` redirects (307, relative) to `/admin`.
    - Paths outside the allowlist get a 404.
    - Anonymous requests to `/admin*` redirect to `/login?callbackUrl=…` on the same host.
    - Responses carry `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `noindex` and `Referrer-Policy`.
  - On customer and app hosts:
    - `/admin*` redirects (307) to the admin origin, keeping the path.
    - `/apps/operator` redirects to the admin `/admin`.
    - `/api/admin/*` (except the legacy `/api/admin/subscription`) and `/api/operator*` return 404 `admin_host_required`.
  - On every host, mutating `/api/*` requests with a cross-site or same-site `Sec-Fetch-Site`, or with a mismatched `Origin`, get a 403. Exempt: `/api/auth/*`, `/api/embed/bootstrap`, `/api/admin/subscription`, and the dev localhost CORS remotes.
  - Landing-host detection now uses the effective host and `SORYE_PUBLIC_HOST` (`landingSlugForHost` in `lib/app-landings.ts`).
- **`apps/hub/lib/admin/access.ts`** (new). `adminAccess()` is the server-side gate. It requires the admin host, a real Auth.js session (embed cookies are not accepted; the dev bypass works only in development), and `isPlatformAdmin`. It returns `actorId = user:<id>`. The file also has a per-actor write rate limit (30/min, in-process), `readAdminJson` (16 KB body cap), and `adminNoStore` headers.
- **`apps/hub/lib/platform-admin.ts`**: production fails closed when `ADMIN_EMAILS` is empty.
- **`apps/hub/lib/env.ts`**: production refuses to start when `AUTH_URL` is set, because it pins one origin and breaks admin login. Also validates `SORYE_PUBLIC_HOST` / `SORYE_ADMIN_HOST` and requires them to differ.
- **`apps/hub/app/login/page.tsx`**: on the admin host it shows admin wording, defaults `callbackUrl` to `/admin`, and hides the Contact/Architecture links.
- **Tests:** `apps/hub/test/admin-hosts.test.ts` (6 tests, passing).

### Operator retirement and reuse (stage 2, partial)
- The `operator` entry was removed from `APP_CATALOG` (`packages/types/src/apps.ts`), and `RETIRED_APP_IDS = ['operator']` was added.
- `selectableAppCount` now ignores IDs that are not in the catalog, so stored `'operator'` selections never count toward a plan.
- Also removed:
  - the Operator branch in `apps/hub/components/hub-native-app.tsx`
  - the `operator` icon in `app-icon.tsx`
  - the landing copy in `app-landings.ts`
  - the four translated rows and the id in `app-landing-translations.ts`
  - `operator` from the gateway loop in `.forgejo/workflows/publish-frontend.yml`
  - the file `deploy/dockyard-operator.compose.yml`
- `components/app-operator.tsx` moved to **`apps/hub/components/admin/operator-panels.tsx`** and became `OperatorPanels({ sections, title, intro, onWorkspaceSelect? })`. It keeps the same `/api/operator` snapshot and forms. Additions:
  - a 30 s refresh that pauses while the tab is hidden or offline
  - audit-aware status messages
  - an optional "Review workspace" picker
- `/api/operator`, `/api/operator/plan` and `/api/operator/notices` now use `adminAccess()`. Plan and notice writes are rate-limited and wrapped in `auditedAdminAction`: a pending audit event must be recorded in Rodrigo before the change runs, then the outcome is appended. If the pending event cannot be recorded, the route returns 503 `audit_unavailable` and changes nothing.

### Console UI (stage 2, started)
- **`apps/hub/app/admin/layout.tsx`**: server-gated. Non-admin host → 404, anonymous → login, signed-in non-admin → a distinct "Not a platform administrator" page. Has a sign-out server action.
- **`components/admin/admin-shell.tsx`**: `StandaloneAppBar` (new optional `hubHref` prop in `packages/platform/src/chrome.tsx`) plus the seven-section nav.
- **`components/admin/admin-styles.ts`**, **`ui.tsx`** (Badge, LoadNotice, PageHeader, responsive AdminTable) and **`use-admin-json.ts`** (coalesced fetch, visibility/offline-paused polling, `adminSend`).
- **Pages that exist:** `/admin` (Overview: health, errors, activity, usage, app load) and `/admin/workspaces` (plans and notices). Both use `OperatorPanels`.

### Durable configuration, audit and propagation (stage 3, Hub side written, not run end to end)
- **`packages/types/src/platform-config.ts`** (exported from the package index): `SharedAiConfigV1`, the write/rollback/commit/applied/audit DTOs, `RODRIGO_PLATFORM_WORKSPACE_ID = 'rodrigo-platform'`, and `SHARED_AI_LIMITS`.
- **`apps/hub/lib/rodrigo/platform-client.ts`**: signed client for these routes, with strict zod response schemas:
  - `GET`/`PUT /v2/platform/config/shared-ai`
  - `POST …/rollback`
  - `GET`/`POST …/applied`
  - `POST /v2/platform/audit`
  - `GET /v2/platform/audit/{limit}/{cursor}`

  `service-client.ts` now exports `rodrigoServiceRequest`.
- **`apps/hub/lib/llm-control.ts`**: tracks where settings came from (`environment | legacy-file | platform | platform-cache`). Adds `applyPlatformLlmSettings()` and `getLlmControlSource()`. `getLlmControlSettings()` no longer overwrites applied platform settings with environment defaults. **Removed** `saveLlmControlSettings` and `setLlmInferencePaused`, so the legacy file is no longer written for settings (no dual writer). User GPU preferences are unchanged.
- **`apps/hub/lib/platform-config/watcher.ts`**: one watcher per process.
  - Loads the last-known-good cache (`.data/platform-config/<consumer>-shared-ai.json`) at boot.
  - Polls Rodrigo every `PLATFORM_CONFIG_POLL_MS` (default 15 s, bounded 2–300 s), with single-flight requests.
  - Applies new revisions and reports `applied` or `failed` (`invalid_value`) as `service:hub` / `service:ocr-worker`, refreshed every 60 s.
  - Started from `instrumentation.ts` (Hub, without blocking boot) and from `lib/workers/ocr-worker.ts` (worker; it now also calls `initializeLlmControl()`).
- **`apps/hub/lib/admin/shared-ai.ts`**:
  - Read model: durable revision and value, this Hub's effective settings and source, and per-consumer propagation (`applied | pending | failed | unknown`; a report older than 3 min counts as `unknown`).
  - Write and rollback: Hub-side validation includes the `assertSafeLlmBaseUrl` allowlist. A client-supplied `changeId` makes retries idempotent. Rodrigo returns 409 on a stale revision. An unknown outcome returns 503 with retry guidance. After a commit, the Hub refreshes and applies immediately.
- **Console APIs (new):**
  - `GET`/`PUT /api/admin/console/config/shared-ai` (with `ETag`)
  - `POST /api/admin/console/config/shared-ai/rollback`: writes a new revision copying an older one; history is never rewritten
  - `GET /api/admin/console/audit`
  - `GET /api/admin/console/workspaces/[workspaceId]`: read-only members and apps for one explicitly chosen workspace
  - `GET /api/admin/console/platform`: integration configured flags and hostnames only, delivery and remote origins, access policy, and a coalesced Rodrigo capabilities/topology probe (`lib/admin/platform-status.ts`)
- **`/api/admin/llm`**: now read-only telemetry behind `adminAccess`, with a 5 s coalesced GPU/provider probe. PATCH was removed.
- **`/api/admin/llm/action`**: now accepts only `stop`, which is audited and allowed only after the Hub has applied `paused=true`. Pause and resume are now the `paused` field of the config. Stop aborts only this Hub process's requests and unloads Ollama. It does not cancel requests already running in the worker.

### Rodrigo contract (separate repo, written by a sub-agent, not verified by me)
`D:\projects\rodrigo` now contains:
- new files: `migrations/postgresql/005_platform_config.sql`, `src/platform.rs`, `src/platform_http.rs`, `src/adapters/pg_platform.rs`, `scripts/extend-platform-contract.mjs`
- modified files: `src/http.rs`, `src/contract.rs`, `src/services.rs`, `src/lib.rs`, `src/metrics.rs`, `src/adapters/mod.rs`, `contracts/rodrigo.openapi.json`, `contracts/rodrigo.ts`, `contracts/rodrigo-capabilities.fixture.json`, `tests/contract.rs`, `tests/providers.rs`, `compose.test.yml`, and the docs (CONTRACTS, OPERATIONS, OWNERSHIP, SECURITY)

The intended design: platform config and audit tables, the reserved `rodrigo-platform` grant, `platform:*` scopes, the `shared-ai` namespace, revision conflicts, idempotency receipts, audit committed in the same transaction as the config write, and a `platform` block in capabilities. That sub-agent may still have been running when this was written. **Its result has not been reviewed, built or tested.**

### Deployment artifacts (written, not built)
- `deploy/app.Dockerfile`: new `admin-gateway` target.
- `deploy/admin.nginx.conf` + `deploy/admin-proxy.inc`: allowlist proxy that sets Host / X-Forwarded-Host / X-Forwarded-Proto, `/` → `/admin`, everything else 404, 64 KB body limit.
- `deploy/dockyard-admin.compose.yml`: loopback port 8130, read-only root filesystem with tmpfs, 64 MB memory, healthcheck. `docker compose config` passed.
- The publish workflow publishes `$image-admin:$tag`.

## Not done

### Not started
- **Pages `/admin/applications`, `/admin/applications/[appId]`, `/admin/ai`, `/admin/integrations`, `/admin/releases`, `/admin/history`.** The nav links to them, but they currently return 404. Their APIs exist except the per-app detail.
- **AI editor UI.** It needs a form for `shared-ai` with revision/ETag conflict handling, a pause/resume toggle, stop, rollback, and the propagation table. The API is ready.
- **Settings inventory and matrix.** Planned as `apps/hub/lib/admin/settings-inventory.ts`, a generated `docs/admin/SETTINGS-MATRIX.md`, and a test that every catalog app is covered. A read-only explorer sub-agent was gathering per-app facts; its output has not been collected.
- **Dashboard LLM tab.** `apps/dashboard/src/LlmControl.tsx` still calls the removed `PATCH /api/admin/llm` and `pause`/`resume`, and those APIs now exist only on the admin host. **The Dashboard's admin LLM tab is currently broken.** Replace the admin part with a link to the admin console's AI page and keep the user GPU preferences.
- **Sorye-side Rodrigo integration:**
  - update the reviewed snapshot `packages/types/contracts/rodrigo.openapi.json` and the fixture `rodrigo-capabilities.fixture.json` from Rodrigo's `contracts/`
  - reconcile DTOs and response schemas with what Rodrigo actually implemented (check especially the audit append `status` values, the cursor format, and the actor-id rules for `user:<id>`)
  - add `apps/hub/test/rodrigo-platform-config.test.ts` to `test:rodrigo`
- **Docs:**
  - `docs/apps/APPS.md`: remove the Operator section and table rows, and add an admin console section
  - `docs/AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `RODRIGO-DATA-CONTRACT.md`, `RODRIGO-DATABASE-SWITCHING-RUNBOOK.md` and `INFRASTRUCTURE-ARCHITECTURE.html` still mention Operator
  - both behavior-tree formats (`docs/APP-BEHAVIOR-TREE.md` and `.html`)
  - `deploy/README.md` and `deploy/VERIFICATION.md`: admin gateway, DNS/TLS/ingress examples, Google OAuth callback `https://admin.sorye.app/api/auth/callback/google`, `HUB_UPSTREAM`, rollback
  - `.env.example`: `SORYE_PUBLIC_HOST`, `SORYE_ADMIN_HOST`, `SORYE_EXTRA_HOSTS`, `PLATFORM_CONFIG_POLL_MS`
  - runbook `docs/admin/ADMIN-CONSOLE-RUNBOOK.md` and report `docs/admin/ADMIN-CONSOLE-VERIFICATION.md`
- **Sandbox:**
  - apply Rodrigo migration 005 to the sandbox database **without destroying anything**. Rodrigo readiness checks the platform tables, so the sandbox Rodrigo container will fail readiness until this is done.
  - then rebuild with `docker compose -f .local/sandbox/compose.json up -d --build`
- **Not verified at all:**
  - real browser checks
  - forged Host/forwarded-host checks against a production-mode build
  - checks for anonymous, member, revoked-admin and platform-admin users
  - stale-revision conflict, dependency outage, worker propagation and restart behavior
  - image builds
  - measurements

### Started but incomplete
- **Workspaces section.** Plans and notices work. The members/apps detail API exists, but `onWorkspaceSelect` is not wired to a detail panel yet.
- **Audit of Hub-owned actions.** This is non-atomic by design: a pending intent is recorded first, then the outcome. If the outcome append fails, the route returns `auditOutcomeRecorded:false` and logs a warning. This limitation still needs documenting in the runbook.
- **OCR worker propagation.** The code is in place. The worker needs `RODRIGO_BASE_URL`, `RODRIGO_KEY_ID` and the signing key; the compose file already mounts the key, and the Hub env file must provide the other two. It has not been run.

### Deferred on purpose (the console must show these as unavailable)
- **Membership/role editing by admins.** Read-only; changes stay with the workspace owner flows.
- **Plan definition and price editing.** Source-managed.
- **Stripe billing.** Not implemented.
- **Frontend remote URLs.** Build inputs that require a Hub rebuild.
- **Deployment-managed settings:** DNS/TLS, image promotion, migrations, key rotation, secrets.
- **Durable admin role model.** `ADMIN_EMAILS` remains the bootstrap.
- **Recent-authentication requirement for critical actions.** Not wired to Google re-auth.
- **Cancelling in-flight worker LLM requests.** Pause only stops new requests; Stop affects only the Hub process.
- **Multi-replica rate limiting.** The limit is process-local; the Hub runs as a single replica.

## Decisions already made
- `/admin` on the customer or app host redirects (307) to the admin origin. The admin routes still enforce platform-admin authorization themselves (`adminAccess`), and admin APIs answer only on the admin host.
- **Operator is retired** from the customer Hub. Its services (`lib/operator/**`, `/api/operator*`) are reused by the console only, and Reports is unchanged.
- **Full scope:** the Rodrigo-owned `shared-ai` configuration and platform audit contract, written in Rodrigo's own `contracts/` with a non-destructive migration 005.
- **Configuration precedence:** a Rodrigo revision (≥1) wins, then the last-known-good local cache, then the legacy `llm-control.json` (read-only bootstrap), then environment defaults. Writes return 503 when Rodrigo is not configured, so there is no silent fallback writer.
- **Pause, stop, cancel and unload:**
  - Pause is `paused=true` in the config. Each process refuses new LLM requests once it has applied that revision.
  - Stop requires pause first. It aborts in-flight requests in the Hub process and unloads Ollama; vLLM stays loaded.
  - Requests already running in the worker are not cancelled.
- **Local admin host:** `admin.localhost:<port>`, for example `http://admin.localhost:23000` in the sandbox. No hosts-file change is needed, and it is accepted only outside production.
- **Production:** unknown hosts get 421, `AUTH_URL` must stay unset, an empty `ADMIN_EMAILS` means no platform admins, and `AUTH_DEV_BYPASS` is rejected. Sessions stay host-only; cookies are never widened to `.sorye.app`.
- **Admin gateway port:** 8130 (8120 was Operator's), image `$image-admin:$tag`.

## How to continue
1. Check Rodrigo first. Run `git status` in `D:\projects\rodrigo` and review the sub-agent's changes. Then run:
   - `cargo fmt --check`
   - `cargo clippy --locked --all-targets -- -D warnings`
   - `cargo test --locked`
   - the provider tests against the disposable Postgres from `compose.test.yml`
2. Copy Rodrigo's `contracts/rodrigo.openapi.json` and the capabilities fixture into `packages/types/contracts/`. Then:
   - reconcile `packages/types/src/platform-config.ts` and `apps/hub/lib/rodrigo/platform-client.ts`
   - add `test/rodrigo-platform-config.test.ts` to `test:rodrigo`
   - run `pnpm --filter @sorye/hub test:rodrigo`
3. Build the remaining console pages, including the AI editor with ETag conflict handling, and wire the workspace detail panel. Replace the Dashboard's admin LLM tab with a link to the console.
4. Write the settings inventory module, the matrix doc and the coverage test. Then do the docs and behavior-tree updates listed above.
5. Sandbox:
   - apply `005_platform_config.sql` to the sandbox Postgres non-destructively with psql, inside a transaction
   - rebuild with `docker compose -f .local/sandbox/compose.json up -d --build`
   - restart ingress if the Hub returns 502
   - verify `http://admin.localhost:23000`
6. Verify end to end yourself. For anonymous, member and forbidden checks, run a Hub without `AUTH_DEV_BYPASS`. For host checks, use a production-mode build. Also build the admin-gateway and worker images.

**Constraints:**
- Never run `down -v`, delete volumes, or re-run `sandbox/setup.mjs`; leave the sandbox running.
- Do not commit or push unless asked.
- Preserve all existing uncommitted work in both repos. Pre-existing changes to the publish workflows, deploy README/VERIFICATION, the OCR worker heartbeat, the behavior tree, ARCHITECTURE and Rodrigo docs/tests were already there; build on them.
- No production deployment, image promotion, credential rotation, destructive migration or live database change. Never print credentials.

## Verification
**Run, with results:**
- `npx tsc --noEmit -p .` in `apps/hub`: **pass**.
- `npx tsc --noEmit` in `packages/platform`: **pass**.
- `npx tsc --noEmit` in `packages/types`: **fails** with `src/tasks.ts(75,18): Cannot find name 'URL'`. That file is untouched by this work, so the failure predates it. The Hub typecheck, which consumes this package, passes.
- `npx tsx --test test/admin-hosts.test.ts`: **6/6 pass**.
- `node --test lib/operator/operator.test.cjs`: **5/5 pass**.
- `docker compose -f deploy/dockyard-admin.compose.yml config --quiet` with placeholder values: **pass**.

**Not run:**
- all Rodrigo checks (`cargo fmt`, `clippy`, `test`, provider tests)
- `test:rodrigo`
- the full Hub test suite
- `next build`
- any image build: Hub, admin-gateway, worker
- Compose validation of the other compose files
- the sandbox migration and rebuild
- any browser test: admin host, login continuity, reload, redirects, forged hosts, conflicts, outages
- propagation to a running OCR worker
- any performance measurement
