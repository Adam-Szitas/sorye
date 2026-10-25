# Security Model

Security helpers live in `apps/hub/lib/security.ts`. This document summarizes threats, mitigations, and remaining gaps.

## Authentication boundaries

| Surface | Protection |
|---------|------------|
| Hub UI + most APIs | Google session via Auth.js; `ensureHubUser()`. Local **only:** `AUTH_DEV_BYPASS=true` + `NODE_ENV=development` seeds a workspace user (see below). |
| Embed iframe | HMAC embed cookie; origin allowlist on bootstrap |
| Admin subscription API | `x-admin-secret` (timing-safe compare) — no session |
| Reports API | Session + platform admin (`ADMIN_EMAILS`, timing-safe email compare) |
| Public | Login, OAuth callbacks, embed bootstrap (key-gated), Contact (`/contact`, `/apps/contact`), Site (`/s/[slug]`, published blocks only) |

All data APIs scope by **`session.workspace.id`** from the server session. Channel/board/handoff IDs are validated against that workspace.

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
| `POST /api/handoffs` | Max payload size (2 MB JSON) |
| `POST /api/storefront/products` | Title/price required; payload size cap; workspace from session |
| `POST /api/storefront/orders` | Known products only; qty/line caps; payload size cap; workspace from session |
| `POST /api/mail` | Workspace members / generated addresses only; image data URL schema; subject/body caps; workspace from session |
| Mail `/api/mail/accounts*` | Session workspace + user; IMAP/SMTP hosts SSRF-checked (`assertSafeMailHost`); Gmail/Outlook hosts are presets (client host ignored); app passwords AES-256-GCM at rest (`MAIL_SECRET_KEY` or `AUTH_SECRET`); never returned to the client; rate-limited test/sync/send; payload size caps |
| Drive `/api/files` | Workspace from session; bytes on disk under `.data/files/{workspaceId}/{uuid}` (never JSON/Postgres blobs); lookup by id **and** workspaceId; rename changes `displayName` only; path resolve + prefix check; mime sniff + size cap; `Content-Disposition: inline` only for raster images, PDF, and text/csv/json/markdown (`?inline=1`) — never HTML/SVG/script |
| `POST /api/messenger` | Image data URL schema; text length cap |
| `GET`/`PUT /api/tasks` | Workspace from session; board shape + size caps |
| `GET`/`PUT /api/notes` | Workspace from session; note count/title/body caps |
| `GET`/`PUT /api/calendar` | Workspace from session; event count/title/date caps |
| `PATCH /api/relay` | Webhook URL safety on channel save |
| `POST /api/ocr/analyze` | Session workspace; PDF magic-byte + 64 MB + 500 page caps; rate limit on new uploads; PDF bytes are not stored; `OCR_LLM_BASE_URL` is server env only and allowlisted (`localhost`, `127.0.0.1`, `::1`, `qwen3`, `host.docker.internal`) so it cannot be aimed at a metadata address; pattern JSON size cap. `POST /api/ocr/analyses/{id}/continue` resumes the same workspace row and does not count as a new upload. |
| `GET /api/ocr/analyses` | Session workspace; list/get never cross workspaces. `POST /api/ocr/analyses/query` searches the latest 50 rows in that workspace (UTC dates, names, JSON keys, codes, amounts) and does not return page transcripts. `PATCH /api/ocr/analyses/{id}` renames a row in the same workspace; the name is stripped of control characters and capped at 180 characters. |

### Other hardening

- Admin secret: `timingSafeEqualString`
- Login redirect: `safeRedirectPath` — relative paths only
- Protocolio health: internal URLs/tokens hidden from non-admin users
- Embed OPTIONS: no wildcard origin reflection
- Embed session: removed spoofable `Sec-Fetch-Dest` check; referer `/embed/` only

## Remaining gaps (documented, not yet fixed)

| Issue | Severity | Notes |
|-------|----------|-------|
| CSRF on cookie-authenticated POST/PATCH | Medium | SameSite cookies + JSON APIs reduce risk; consider CSRF tokens for mutations |
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
4. Restrict `ADMIN_EMAILS` to operators
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
