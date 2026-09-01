# Security Model

Security helpers live in `apps/hub/lib/security.ts`. This document summarizes threats, mitigations, and remaining gaps.

## Authentication boundaries

| Surface | Protection |
|---------|------------|
| Hub UI + most APIs | Google session via Auth.js; `ensureHubUser()`. Local **only:** `AUTH_DEV_BYPASS=true` + `NODE_ENV=development` seeds a workspace user (see below). |
| Embed iframe | HMAC embed cookie; origin allowlist on bootstrap |
| Admin subscription API | `x-admin-secret` (timing-safe compare) — no session |
| Public | Login, OAuth callbacks, embed bootstrap (key-gated) |

All data APIs scope by **`session.workspace.id`** from the server session. Channel/board/handoff IDs are validated against that workspace.

### Local auth bypass (`AUTH_DEV_BYPASS`)

Skips Google in **`next dev` only** so http://localhost:3000 opens the Hub launcher. `ensureHubUser()` reuses the first `ADMIN_EMAILS` user if one exists, otherwise provisions `dev-local` / `dev@localhost`. APIs still take `workspaceId` from that session — never from the client body.

- Requires **both** `NODE_ENV=development` and `AUTH_DEV_BYPASS=true`
- `getEnv()` **refuses to boot** if the flag is set when `NODE_ENV=production` (Fly.io)
- Do not set this secret on Fly.io; production auth remains Google OAuth

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
| `POST /api/handoffs` | Max payload size (2 MB JSON) |
| `POST /api/messenger` | Image data URL schema; text length cap |
| `PATCH /api/relay` | Webhook URL safety on channel save |

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
