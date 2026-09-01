# Sorye Core Architecture

This document describes how the Sorye platform is structured for developers and AI agents working in the monorepo. Read this first before touching Hub APIs, micro-frontends, or cross-app flows.

## Mental model

Sorye is a **workspace OS**: users sign in once, pick apps from a catalog, and run them inside a shared shell. Apps are mostly **Module Federation remotes** loaded by the **Hub** (Next.js). Shared contracts live in **`@sorye/types`**. Cross-app behavior uses **workspace events**, **Relay routing**, **handoffs**, and **notifications** — all orchestrated by Hub APIs.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Hub (Next.js 15) — auth, launcher, API, MF host, embed   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │  │
│  │  │ MF remote   │  │ MF remote   │  │ iframe (SUSM/ESPM)  │ │  │
│  │  │ e.g. OCR    │  │ e.g. Tasks  │  │                     │ │  │
│  │  └──────┬──────┘  └──────┬──────┘  └─────────────────────┘ │  │
│  └─────────┼────────────────┼──────────────────────────────────┘  │
└────────────┼────────────────┼───────────────────────────────────┘
             │ fetch /api/*    │
             ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Hub server libs: store, events, relay, notifications, handoffs │
│  Storage: JSON (.data/) dev  OR  Postgres (@sorye/db) prod      │
└─────────────────────────────────────────────────────────────────┘
```

## Monorepo layout

| Path | Role |
|------|------|
| `apps/hub/` | Shell, auth, all `/api/*` routes, MF host, embed host |
| `apps/<name>/` | Vite MF remotes (dashboard, ocr, messenger, …) |
| `packages/types/` | Single source of truth: catalog, events, relay, workspaces |
| `packages/sdk/` | Lit design-system components + React wrappers |
| `packages/db/` | Drizzle schema + Postgres client |
| `docs/` | Architecture, security, per-app reference |

**Tooling:** pnpm workspaces + Turbo. `pnpm dev` starts Hub (3000) and all remotes (3001–3012).

## App catalog (`packages/types/src/apps.ts`)

Every installable app is an `AppCatalogEntry`:

- **`id`** — stable key used in `workspace.selectedAppIds`
- **`slug`** — URL segment (`/apps/ocr`, embed `app=ocr`)
- **`microFrontend`** — MF remote config (`remoteName`, `remoteEntry`, `./mount`)
- **`external`** — iframe apps (SUSM, ESPM) instead of MF
- **`usageIntro`** — first-run guidance shown in Hub picker

Subscription plans cap how many apps and connections a workspace may use (`packages/types/src/subscriptions.ts`).

## Hub shell

**Entry:** `apps/hub/components/hub-shell.tsx`

Responsibilities:

1. **Session** — `useHubSession()` → `GET /api/workspace`
2. **Launcher** — home grid with per-app notification badges
3. **Split panes** — left/right MF apps (`AppWorkspace` + `MicroAppLoader`)
4. **Dock** — Home, workspace switcher, notification bell
5. **Connections** — REST keys, embed widgets
6. **Notifications** — `NotificationProvider`, toasts, click-to-open app

Pane state persists in `sessionStorage` (`sorye:hub:panes`).

## Module Federation

**Host:** `@module-federation/runtime` in `micro-app-loader.tsx`

**Remote pattern:** each app exposes `./mount` from `src/mount.tsx`:

```tsx
export function mount(container: HTMLElement) {
  const root = createRoot(container);
  root.render(<App />);
  return () => root.unmount();
}
```

Remotes call Hub APIs with `fetch('/api/...', { credentials: 'include' })` — same origin when embedded in Hub.

Production remote URLs come from `NEXT_PUBLIC_*_REMOTE` env vars (`apps/hub/lib/mf-remotes.ts`).

## Authentication & sessions

| Layer | Implementation |
|-------|----------------|
| User auth | Google OAuth via Auth.js v5 (`auth.ts`, `middleware.ts`). Local `AUTH_DEV_BYPASS=true` seeds a user through `ensureHubUser()` — production ignores/rejects this. |
| Hub session | `ensureHubUser()` → user + active workspace + selected apps |
| Embed | HMAC-signed cookie from `/api/embed/bootstrap` + `/api/embed/enter` |
| Admin | `ADMIN_EMAILS` on user record; `x-admin-secret` for subscription API |

**Middleware** protects all routes except `/login`, `/api/auth/*`, `/embed/*`, `/api/embed/*`, `/api/admin/*`.

Workspace scoping: every authenticated API uses `session.workspace.id` from the server — never trust client-supplied workspace IDs.

## Storage

### Store driver

`STORE_DRIVER=json` (local) or `postgres` (production). Facade: `apps/hub/lib/store/index.ts`.

| Driver | Core state | App-specific state |
|--------|------------|-------------------|
| JSON | `apps/hub/.data/store.json` | Separate `*-json.ts` modules |
| Postgres | `@sorye/db` schema | Same APIs, postgres implementations |

Production **rejects** `STORE_DRIVER=json` (`lib/env.ts`).

### Per-workspace Postgres override

Canvas and Messenger can use a workspace-specific Postgres URL (`/api/workspace/storage`). Useful for enterprise isolation.

## Cross-app communication

### 1. Workspace events

**Types:** `packages/types/src/events.ts`  
**Server:** `apps/hub/lib/events.ts`  
**API:** `POST /api/events`

Flow:

1. Micro-app calls `emitWorkspaceEvent(name, payload)` (`apps/*/src/emit-event.ts`)
2. Hub validates name + payload, checks feature flag (`event-settings.json`)
3. If enabled → Relay delivery + notification record + optional Messenger `#events` post

**Prerequisite:** Messenger + ≥1 other app selected; user enables in Dashboard.

**Event names** (allowlisted): `sorye.task.moved`, `sorye.ocr.analyzed`, `sorye.protocolio.generated`, etc.

### 2. Relay

**Types:** `packages/types/src/relay.ts`  
**Server:** `apps/hub/lib/relay.ts`  
**API:** `GET/PATCH/POST /api/relay`

Routes workspace events to:

| Channel | Status |
|---------|--------|
| Messenger `#events` | Live — `postSystemMessage` |
| Webhook | Live — HTTPS POST (SSRF-protected) |
| Email / WhatsApp | Queued — connectors not wired |

Config per workspace in `.data/relay.json` (or Postgres equivalent).

### 3. Handoffs

**Types:** `packages/types/src/handoffs.ts`  
**API:** `GET/POST/PATCH /api/handoffs`

Structured payloads between apps (e.g. OCR → Protocolio `pdf-template`). Target app polls `GET ?targetAppId=protocolio&unconsumed=1`.

Client refresh: `BroadcastChannel('sorye-app-handoff')`.

### 4. Notifications

**Types:** `packages/types/src/notifications.ts`  
**Server:** `apps/hub/lib/notifications.ts`  
**API:** `GET/PATCH/POST /api/notifications`

Created when events publish. UI: bell, toasts, per-app badges on launcher. Messenger unread chat merged via `messenger-unread.ts`.

Refresh signals:

- `window` event `sorye:hub:notify` (`HUB_NOTIFY_EVENT`)
- `BroadcastChannel('sorye-notifications')`

### 5. Messenger (direct)

**API:** `/api/messenger` — channels, DMs, messages, mark-read

Not the same as events — this is human chat. `#events` is a system channel fed by Relay.

## Embed

Customer sites load `embed.js` → `POST /api/embed/bootstrap` (API key + origin allowlist) → iframe `/embed/[slug]`.

Chrome-less MF mount; embed session cookie scoped to widget workspace.

## Key API routes (quick reference)

| Route | Purpose |
|-------|---------|
| `/api/workspace` | Hub session; PATCH selected apps |
| `/api/events` | Publish + toggle App events |
| `/api/relay` | Relay config + test delivery |
| `/api/notifications` | Feed, settings, mark read |
| `/api/handoffs` | Cross-app payloads |
| `/api/messenger` | Chat bootstrap + messages |
| `/api/canvas/boards/*` | Boards + SSE realtime |
| `/api/protocolio/generate` | Hub bridge to external PDF API |
| `/api/embed/*` | Widget keys + bootstrap |

## Adding a new micro-frontend

1. Scaffold `apps/<name>/` — Vite + `@module-federation/vite`, expose `./mount`
2. Register in `packages/types/src/apps.ts` (Catalog app lists this automatically)
3. Add dev script filter in root `package.json`
4. Add `NEXT_PUBLIC_*_REMOTE` in `.env.example` + `mf-remotes.ts`
5. Document in `docs/apps/APPS.md` (required — see `.cursor/rules/app-catalog.mdc`)
6. Optional: `emit-event.ts` + event name in `events.ts` + Relay source

## Agent navigation tips

| Task | Start here |
|------|------------|
| Change app catalog | `packages/types/src/apps.ts` |
| Hub UI / launcher | `apps/hub/components/hub-shell.tsx` |
| Auth / session | `apps/hub/lib/ensure-user.ts` |
| Event pipeline | `apps/hub/lib/events.ts` → `relay.ts` |
| Notification badges | `apps/hub/lib/notifications.ts`, `use-notifications.tsx` |
| MF loading | `apps/hub/components/micro-app-loader.tsx` |
| Security helpers | `apps/hub/lib/security.ts` |
| Per-app behavior | `docs/apps/APPS.md` |

See also: [SECURITY.md](./SECURITY.md), [apps/APPS.md](./apps/APPS.md).
