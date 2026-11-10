# Security Model

**Rodrigo v2 status:** Hub has signed action batch, single-resource, collection, channel-authorized Messenger timeline, and reserved-grant published Site routes for typed v2 families. Migrated browser writes use scoped IndexedDB queues; Hub checks the queue scope against the current signed-in user/workspace before signing. Tasks, Notes, Calendar, Canvas, Site editing and published public reads, Storefront products and enquiry orders, workspace profile name/read paths, and Messenger text/channel resources use the v2 gateway, with legacy resource writers disabled. Most other app/worker writes, blobs, external jobs, event delivery, Messenger attachments/read receipts, and Storefront status transitions remain uncovered. Failures stay pending or visible for reconciliation and never fall back to Hub writers. See [the durable data contract](RODRIGO-DATA-CONTRACT.md) and [database switching runbook](RODRIGO-DATABASE-SWITCHING-RUNBOOK.md).

Security helpers live in `apps/hub/lib/security.ts`. This document summarizes threats, mitigations, and remaining gaps.

## Authentication boundaries

| Surface | Protection |
|---------|------------|
| Hub UI + most APIs | Google session via Auth.js; `ensureHubUser()`. Local **only:** `AUTH_DEV_BYPASS=true` + `NODE_ENV=development` seeds a workspace user (see below). |
| Embed iframe | HMAC embed cookie; origin allowlist on bootstrap |
| Admin subscription API | `x-admin-secret` (timing-safe compare) — no session |
| Backend topology API | Server session plus `isPlatformAdmin`; signed server-derived workspace claims to Rodrigo; no-store responses. |
| Reports API | Session + platform admin (`ADMIN_EMAILS`, timing-safe email compare) |
| Administration console (`/admin/**`, `/api/admin/console/**`, `/api/operator/**`, `/api/admin/llm*`) | Admin host only (404 elsewhere), a real Auth.js session (embed cookies and the dev bypass outside development are refused) and `isPlatformAdmin`, all checked in `adminAccess()` on every request. Members get 403 and no payload. A workspace id is accepted only after that check and only if the workspace store contains it. See [Administration console](#administration-console). |
| Public | Login, OAuth callbacks, embed bootstrap (key-gated), Contact (`/contact`, `/apps/contact`), Site (`/s/[slug]`, published blocks only) |

All data APIs scope by **`session.workspace.id`** from the server session. Channel/board/handoff IDs are validated against that workspace.

List routes that show Personal and Work (`notes`, `calendar`, `tasks`, `files`, `messenger`, `notifications`, `canvas`, `ocr`, `relay`, `embed/widgets`, `analytics`, `mail`, `storefront/orders`, `site`) take workspace ids from `session.workspaces` and recheck each one with `getHubSessionForWorkspace`. A client-supplied workspace id is not accepted on those reads. Document reads for a workspace the user belongs to use that check; writes still require the active workspace. A channel with a non-empty `memberIds` list is included only when the user is in it. An empty channel member list means every member of that workspace can see it, because those are the workspace-open defaults and there is no invite table. Another member's personal workspace is absent because it is not in the session. Non-active read failures are omitted so the active list still returns. IMAP is not synced across workspaces on the mail list.

### Local auth bypass (`AUTH_DEV_BYPASS`)

Skips Google in **`next dev` only** so http://localhost:3000 opens the Hub launcher. `ensureHubUser()` reuses the first `ADMIN_EMAILS` user if one exists, otherwise provisions `dev-local` / `dev@localhost`. APIs still take `workspaceId` from that session — never from the client body.

- Requires **both** `NODE_ENV=development` and `AUTH_DEV_BYPASS=true`
- `getEnv()` **refuses to boot** if the flag is set when `NODE_ENV=production` (Fly.io)
- Do not set this secret on Fly.io; production auth remains Google OAuth

### Standalone remote origins (development only)

A Vite app on its own port may call Hub `/api/*` with `credentials: 'include'` when `VITE_HUB_ORIGIN` points at Hub. `apps/hub/middleware.ts` adds `Access-Control-Allow-Origin` only when `NODE_ENV=development` and `Origin` is `http://localhost:<port>` or `http://127.0.0.1:<port>`. Production does not add this policy. The session cookie is still required (or the dev bypass above). `workspaceId` still comes from `ensureHubUser()`. This is not a second auth system.

## Fixes implemented

### SSRF — Relay webhooks

**Risk:** User-configured webhook URLs could target internal metadata (`169.254.169.254`) or localhost services.

**Mitigation:** `assertSafeWebhookUrl()` — HTTPS only in production; blocks private/link-local/metadata hosts; dev allows HTTP to localhost only. Applied in `setRelayConfig` and `deliverWebhook`.

### SSRF — Workspace Postgres test

**Risk:** `POST /api/workspace/storage` could probe internal databases.

**Mitigation:** `assertSafePostgresUrl()` before `testPostgresConnection()`.

### Privilege escalation — JSON store

**Risk:** `PATCH /api/workspace` could spread `memberIds` via json-store patch.

**Mitigation:** `updateWorkspace` in json-store whitelists only `selectedAppIds`, `connectedApps`, `name`.

### Stored XSS — Messenger images

**Risk:** Arbitrary `imageDataUrl` in `href`/`src` (`javascript:`, `data:text/html`).

**Mitigation:** Server validates `data:image/(jpeg|png|webp|gif);base64,...` + size cap. Client renders `<img>` only (no link wrapper).

### Input validation

| Endpoint | Validation |
|----------|------------|
| `POST /api/events` | Allowlisted event names; title/summary length caps |
| `GET /api/reports` | Platform admin only; aggregates counts (event name / appId / day). No payloads. |
| `GET /api/operator` | Admin console (`adminAccess`). Health, activity, usage buckets, app-load totals, grouped errors, workspace plan rows, and platform notices. No document bodies, prompts, cookies, or request bodies. Health probes are cached for a few seconds and are not called from member routes. |
| `POST /api/operator/plan` | Admin console. Sets a workspace plan or stores a future effective date and optional note. The workspace id is checked against the workspace store. No payment provider. Plan `maxApps` comes from the existing plan catalog. Audited (intent before, outcome after); refused if the intent cannot be recorded. The note text is not copied into the audit log. |
| `GET/POST /api/operator/notices` | Admin console. Composer fields: message, audience, optional start and end, active flag. Audited like plans; the audit row stores the message length, not the text. |
| `GET/PUT /api/admin/console/config/shared-ai`, `POST …/rollback` | Admin console, 30 writes per minute per administrator, 16 KB JSON. Strict schema with Rodrigo's bounds plus Hub's provider-host allowlist (SSRF). Requires `expectedRevision` (and a matching `If-Match` when sent) and a UUID `changeId`; Rodrigo commits value, revision and audit row in one transaction and returns 409 on a stale revision. |
| `GET/POST /api/notices` | Signed-in user. Returns only `{ id, message }` for notices whose audience and date window match that user's plan. Dismiss is stored per user. Drafts and other audiences are omitted. |
| `POST /api/handoffs` | Max payload size (2 MB JSON) |
| `POST /api/storefront/products` | Title/price required; payload size cap; workspace from session |
| `POST /api/storefront/orders` | Known products only; qty/line caps; payload size cap; workspace from session |
| `POST /api/mail` | Workspace members / generated addresses only; image data URL schema; subject/body caps; workspace from session |
| Mail `/api/mail/accounts*` | Session workspace + user; IMAP/SMTP hosts SSRF-checked (`assertSafeMailHost`); Gmail/Outlook hosts are presets (client host ignored); app passwords AES-256-GCM at rest (`MAIL_SECRET_KEY` or `AUTH_SECRET`); never returned to the client; rate-limited test/sync/send; payload size caps |
| Drive `/api/files` | Workspace from session; bytes on disk under `.data/files/{workspaceId}/{uuid}` (never JSON/Postgres blobs); lookup by id **and** workspaceId; rename changes `displayName` only; path resolve + prefix check; mime sniff + size cap; `Content-Disposition: inline` only for raster images, PDF, and text/csv/json/markdown (`?inline=1`) — never HTML/SVG/script. Task images are the same store with `sourceAppId=tasks`, Tasks app access, and a 5 MB JPEG/PNG/WebP/GIF cap, at most eight per ticket. The task record stores those file ids only. |
| `POST /api/messenger` | Image data URL schema; text length cap. Mention user ids are kept only when that person belongs to the channel's workspace and can see the channel. The workspace id is the channel's, from the server session, not the client body. A personal-channel ping also requires Messenger in the recipient's personal subscription. |
| Personal list reads | The viewer's personal workspace subscription (selected apps plus always-available apps) filters Personal sections. The personal workspace id comes from the server session. Team lists are not filtered by that personal package. |
| `GET`/`PUT /api/tasks` | Workspace from session; board shape + size caps |
| `GET`/`PUT /api/notes` | Workspace from session; note count/title/body caps |
| `GET`/`PUT /api/calendar` | Workspace from session; event count/title/date caps |
| `PATCH /api/relay` | Webhook URL safety on channel save |
| `POST /api/ocr/analyze` | Session workspace; PDF magic-byte + 64 MB + 500 page caps; rate limit on new uploads; PDF bytes are not stored; `OCR_LLM_BASE_URL` is server env only and allowlisted (`localhost`, `127.0.0.1`, `::1`, `qwen3`, `host.docker.internal`) so it cannot be aimed at a metadata address; pattern JSON size cap. `POST /api/ocr/analyses/{id}/continue` resumes the same workspace row and does not count as a new upload. |
| `GET /api/admin/llm`, `POST /api/admin/llm/action` | Admin console. `GET` is read-only telemetry (one coalesced provider/GPU probe per 5 s). The only action is `stop`, accepted only while this Hub has applied a paused revision; it aborts this Hub's requests and may unload only the configured Ollama model. Settings writes moved to the shared-ai configuration route. No shell command or arbitrary PID kill is exposed. Activity logs omit prompt, PDF, and model response content. |
| `GET/PATCH /api/llm/preferences` | Authenticated workspace user; stores per-user GPU target (`client-webgpu` or `hub-server`), WebGPU power profile, model ID from `WEBGPU_MODEL_CATALOG`, and preferred host GPU index (`0..15`). |
| `GET /api/mcp/tools`, `POST /api/mcp/call`, `POST /api/mcp/chat` | Session workspace and role enforced server-side (`ensureHubUser`); tools are filtered to `selectedAppIds` + always-available apps and `isPlatformAdmin` for admin tools; destructive/external tools require explicit confirmation (`confirmed: true`); MCP never touches backend databases directly — domain reads/writes route through Hub events and signed Ed25519 Rodrigo assertions (`signRodrigoRequest`). Every tool, including `hub.whoami`, `hub.my_day_briefing`, `tasks.complete`/`tasks.delete` (confirmation), `personal.quick_capture`, `files.list_recent` and `hub.switch_workspace`, is permission-checked per call; generic chat questions go to the model or built-in responder and never execute tools; the switch card only calls the existing authorized workspace switch route. |
| `GET /api/ocr/analyses` | Session workspace; list/get never cross workspaces. `POST /api/ocr/analyses/query` searches the latest 50 rows in that workspace (UTC dates, names, JSON keys, codes, amounts) and does not return page transcripts. `PATCH /api/ocr/analyses/{id}` renames a row in the same workspace; the name is stripped of control characters and capped at 180 characters. `PATCH /api/ocr/analyses/{id}/pattern` validates and aligns client WebGPU pattern output against the immutable stored rows (`alignRecordsToRows` / `supplementFromRows`) without overwriting `pages` or `lines`. |
| `GET/POST /api/ocr/active` | Session user and session workspace only. Returns or acknowledges that member's latest OCR background job. A client-supplied workspace id is ignored. |

### Other hardening

- Admin secret: `timingSafeEqualString`
- Login redirect: `safeRedirectPath` — relative paths only
- Protocolio health: internal URLs/tokens hidden from non-admin users
- Embed OPTIONS: no wildcard origin reflection
- Embed session: removed spoofable `Sec-Fetch-Dest` check; referer `/embed/` only

## Remaining gaps (documented, not yet fixed)

| Issue | Severity | Notes |
|-------|----------|-------|
| CSRF on cookie-authenticated POST/PATCH | Low | Middleware refuses `/api/*` writes whose `Origin` host differs from the request host or whose `Sec-Fetch-Site` is `cross-site`/`same-site` (exempt: Auth.js, embed bootstrap, the header-secret subscription API, development standalone remotes). No CSRF token. |
| Plan limits not enforced server-side on `selectedAppIds` | Medium | UI enforces; API should call `trimWorkspaceToPlanLimits` |
| Email/WhatsApp Relay channels | Low | Queued only — no real send yet |
| `.data/` JSON at rest | Low | Dev only; production must use Postgres |
| Default `ADMIN_SECRET` in `.env.example` | High if copied to prod | Rotate in production |
| Embed without Referer | Medium | Direct navigation with token may skip origin check on embed page |
| OCR client-side only | Low | No server upload; large PDFs can stress client |

## Operational checklist (production)

1. Set strong `AUTH_SECRET`, `ADMIN_SECRET` (not dev defaults)
2. Do **not** set `AUTH_DEV_BYPASS` (Hub will refuse to boot if it is `true`)
3. `STORE_DRIVER=postgres` + managed Postgres
4. Restrict `ADMIN_EMAILS` to platform administrators (empty means nobody); leave `AUTH_URL` unset; make every proxy in front of Hub overwrite `X-Forwarded-Host`
5. Review Relay webhook destinations (HTTPS public URLs only)
6. Rotate embed API keys when offboarding customers
7. Enable Fly.io/private networking awareness for any internal services

## Reporting

When extending APIs:

1. Always call `ensureHubUser()` (or embed equivalent)
2. Never use client-supplied `workspaceId` without membership check
3. Validate outbound URLs with `assertSafeWebhookUrl`
4. Validate user content size and shape at route boundary
5. Log relay delivery failures; avoid echoing secrets in error messages

Public app introductions at /learn/[slug] and catalog subdomain roots expose static catalog copy only. App routes and APIs retain their authentication and workspace boundaries.

Protocolio production calls require PROTOCOLIO_SERVICE_TOKEN, provisioned through the engine token system. Browser generation and validation use Hub; no direct generation fallback. Both Hub template routes bound request bodies to 2 MB before parsing. Local Compose exposes the renderer on loopback only and does not publish MongoDB.

## Administration console

The console lives at `admin.sorye.app` and is separated from the customer Hub by hostname, not only by role. Operations: [runbook](admin/ADMIN-CONSOLE-RUNBOOK.md).

- **Host classification** (`apps/hub/lib/admin/hosts.ts`, used by middleware and route handlers): the effective host is the first `X-Forwarded-Host` value, else `Host`. Production accepts only the public host, the admin host, `<slug>.<public host>` app hosts, `SORYE_EXTRA_HOSTS`, and loopback without `X-Forwarded-Host` (container healthchecks); anything else gets 421. Every proxy in front of Hub must overwrite `X-Forwarded-Host`.
- **Admin host allowlist**: only console pages and APIs, Auth.js, `/login`, `/_next` and two backend discovery routes. Everything else is 404; customer pages, app mounts, embeds and public sites are unreachable there. The admin gateway repeats the allowlist.
- **Customer hosts**: `/admin*` and `/apps/operator` redirect to the admin origin; admin-only APIs answer 404 `admin_host_required`.
- **Sessions**: Auth.js cookies are host-only, so an admin session never reaches `sorye.app` and a customer session never reaches the console. `AUTH_URL` is refused in production because it would pin both hosts to one origin.
- **Authorization**: `adminAccess()` on every page and API: admin host, `auth()` session (embed sessions refused), `ensureHubUser()`, `isPlatformAdmin`. Production with an empty `ADMIN_EMAILS` has no administrators. `AUTH_DEV_BYPASS` is refused in production.
- **Responses**: `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `nosniff` on the admin host.
- **Secrets**: integration status shows configured flags and hostnames only. Platform configuration namespaces are non-secret by contract. Audit rows contain field values for configuration and counts/ids for Hub actions (no notice text, plan notes or prompts).
- **Audit**: Rodrigo stores the trail append-only (no update or delete path). Configuration rows are written in the same transaction as the revision. Hub-owned actions record an intent first and an outcome after; when the outcome cannot be written the response says so and the intent row remains.
- **Rodrigo identity**: administrator writes are signed as `user:<id>` under the reserved workspace `rodrigo-platform` with `platform:*` scopes; Hub and the OCR worker sign reads and applied reports as `service:hub` / `service:ocr-worker`, which Rodrigo refuses for writes.

### Rodrigo document forwarding

Migrated v2 APIs enforce workspace membership, enabled app access, queue-scope binding and applicable owner gates before Rodrigo calls. The server session supplies signed actor/workspace identity; browser inputs cannot select the workspace, role, or Rodrigo origin. Outages never switch writers; conflicts remain explicit. Legacy Hub mutation endpoints for migrated resources reject writes. Migration exports contain private workspace data and require restricted backup access. Other app routes must meet these same checks before being counted as migrated.
