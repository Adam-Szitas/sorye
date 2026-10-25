# Sorye Core Architecture

This document describes how the Sorye platform is structured for developers and AI agents working in the monorepo. Read this first before touching Hub APIs, micro-frontends, or cross-app flows.

The same flows are drawn on the public **Architecture** page at `/architecture` (no sign-in). This file is the source of truth for paths, APIs, and what is live versus still a container to add.

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
│  Storage: .data JSON and/or Postgres (workspace-scoped)         │
│  Durable Tasks/Notes/Calendar live here — not in localStorage   │
└─────────────────────────────────────────────────────────────────┘
```

## Monorepo layout

| Path | Role |
|------|------|
| `apps/hub/` | Shell, auth, all `/api/*` routes, MF host, embed host |
| `apps/<name>/` | Vite MF remotes (dashboard, ocr, messenger, …) |
| `packages/types/` | Single source of truth: catalog, events, relay, workspaces |
| `packages/platform/` | Kernel client, global signals, private app signals, framework adapters (`@sorye/platform`) |
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
- **`alwaysAvailable`** — pinned for every workspace (Catalog); does not count toward `plan.maxApps`
- **`adminOnly`** — launcher/dock/picker/Catalog hide these from non-admins (`ADMIN_EMAILS` / `HubUser.isAdmin`). Reports is `alwaysAvailable` + `adminOnly`.
- **`presentationOnly`** — public marketing page (Contact); hidden from customer OS chrome and not a plan slot

Subscription plans cap how many apps and connections a workspace may use (`packages/types/src/subscriptions.ts`).

## Hub shell

**Entry:** `apps/hub/components/hub-shell.tsx`

Responsibilities:

1. **Session** — `useHubSession()` → `GET /api/workspace`
2. **Launcher** — home grid with per-app notification badges
3. **Split panes** — left/right MF apps (`AppWorkspace` + `MicroAppLoader`) plus Hub-native Catalog, Reports, Storefront, Site, Mail, and Drive
4. **Dock** — Home, Apps, Connect, workspace split
5. **Connections** — REST keys, embed widgets
6. **Notifications** — `NotificationProvider`, toasts, click-to-open app

Pane state persists in `sessionStorage` (`sorye:hub:panes`).

## Module Federation

**Host:** `@module-federation/runtime` in `micro-app-loader.tsx`

**Remote pattern:** each app exposes `./mount` from `src/mount.tsx`:

```tsx
export function mount(container: HTMLElement, context?: KernelMountContext) {
  const connected = connectKernel({
    appId: 'tasks',
    framework: 'react',
    context,
    hubOrigin: import.meta.env.VITE_HUB_ORIGIN,
  });
  const root = createRoot(container);
  root.render(
    <KernelProvider kernel={connected.kernel}>
      <App />
    </KernelProvider>,
  );
  return () => {
    root.unmount();
    connected.release();
  };
}
```

Remotes that ignore the second argument keep working. Hub passes `{ kernel }` from `MicroAppLoader`.

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

There are **three** persistence layers. Do not mix them:

| Store | What lives there |
|-------|------------------|
| **Browser localStorage** | Temporary UI only (selected tab, pane widths, dismissed guides, DevKit request log). **Not** for Tasks / Notes / Calendar records. |
| **Hub `.data/*.json` + Drive disk** | Local/dev file store: users/workspaces when `STORE_DRIVER=json`, plus Mail, Storefront, Site, Drive bytes, Relay, events, notifications. |
| **Postgres** (`STORE_DRIVER=postgres`) | Users, workspaces, Messenger, Canvas, Tasks / Notes / Calendar documents (`workspace_app_docs`), and OCR Qwen readings (`ocr_analyses`). |

| Driver | Core state | App-specific state |
|--------|------------|-------------------|
| JSON | `apps/hub/.data/store.json` | Separate `*-json.ts` modules (`workspace-docs.json` for Tasks/Notes/Calendar) |
| Postgres | `@sorye/db` schema | Same APIs, postgres implementations |

Production **rejects** `STORE_DRIVER=json` (`lib/env.ts`). After schema changes run `pnpm db:push`.

### Per-workspace Postgres override

Canvas, Messenger, and Tasks / Notes / Calendar can use a workspace-specific Postgres URL (`/api/workspace/storage`). Useful for enterprise isolation.

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
| `/api/reports` | Admin-only aggregate event charts (counts, no payloads) |
| `/api/relay` | Relay config + test delivery |
| `/api/notifications` | Feed, settings, mark read |
| `/api/handoffs` | Cross-app payloads |
| `/api/messenger` | Chat bootstrap + messages |
| `/api/canvas/boards/*` | Boards + SSE realtime |
| `/api/tasks` | Workspace Kanban board (`GET`/`PUT`) |
| `/api/notes` | Workspace notes (`GET`/`PUT`) |
| `/api/calendar` | Workspace calendar events (`GET`/`PUT`) |
| `/api/storefront/products` | Workspace product catalog (seeded kits) |
| `/api/storefront/orders` | Enquiry/order requests for this workspace |
| `/api/site` | Workspace public site editor (blocks); public view is `/s/[slug]` |
| `/api/mail` | In-workspace mailbox + settings; draft/forward for Messenger |
| `/api/mail/accounts` | Connected IMAP/SMTP accounts (list/add/remove/sync/send/read) |
| `/api/files` | Drive list/upload; `/api/files/[id]` download (or inline preview for safe types), rename, delete |
| `/api/protocolio/generate` | Hub bridge to external PDF API |
| `/api/embed/*` | Widget keys + bootstrap |

## Runtime flows

Apps are frontends. Hub is the kernel. Nothing in an app calls another app. Cross-app work goes through Hub, which validates it and routes it.

### Request

1. The browser opens Hub (`:3000`). Auth.js establishes the session. `ensureHubUser()` loads the user, active workspace, and selected apps. `workspaceId` is taken from that session on every API route.
2. The shell mounts an app. Module Federation remotes expose `./mount` and are loaded from their own origin (`remoteEntry.js`). Hub-native apps (Catalog, Mail, Drive, Site, Storefront, Reports) render inside the Hub bundle. Contact (`/contact`) and Site (`/s/[slug]`) are public pages.
3. The app calls `fetch('/api/...', { credentials: 'include' })` or `kernel.emit`. Embedded remotes stay same-origin with Hub, so the cookie is the Hub session even when the script came from another port. A remote opened on its own port uses the same routes (see Platform SDK).
4. The route checks the payload, then reads or writes through the store driver (Postgres or `.data` JSON). `workspaceId` comes from `ensureHubUser()`, never from the client body.

Relay stays inside Hub. The app does not deliver webhooks itself.

### Events and Relay

1. An app calls `kernel.emit({ type: 'event', name, payload })` (`@sorye/platform`) or the older `emitWorkspaceEvent(name, payload)` helper. Both `POST /api/events`. Names are allowlisted. The client does not send `workspaceId`.
2. `POST /api/events` checks the allowlisted name, payload size, and the workspace feature flag.
3. Hub runs `deliverEventViaRelay` in-process: Messenger `#events` and HTTPS webhooks are live; email and WhatsApp are queued, not sent.
4. Hub writes a notification. The shell updates badges via `sorye:hub:notify` and `BroadcastChannel('sorye-notifications')`.

Handoffs (`/api/handoffs`) are the structured variant: a source app leaves a payload, the target polls `unconsumed=1`. Messenger chat is a separate API (`/api/messenger`); `#events` is the system channel Relay fills.

### State

| Scope | Owner | What it holds | How another app sees it |
|-------|--------|----------------|-------------------------|
| Kernel (global) | Hub (`createKernelHost`) | Session, workspace, focused app, notification unread count. Signals are writable only inside the host. | Read-only `kernel.signals` / `kernel.getState()`. Cross-app writes are `kernel.emit` (events, handoffs) or `kernel.navigate`. |
| App (private) | That app (`createAppStore`, `signal`, `computed`) | Its own UI state and drafts. Stays in the app bundle. | It does not. No app-to-app imports or direct calls. |

Browser `localStorage` is for pane widths, dismissed guides, and similar chrome. It is not the kernel store and not the Tasks / Notes / Calendar record store.

`@sorye/sdk` is the Lit design system (buttons, cards, tokens). `@sorye/platform` is the kernel client. Do not confuse them.

### Platform SDK (`@sorye/platform`)

Package path: `packages/platform`. Signals core is `@preact/signals-core`, shared by every adapter. There is no Redux store.

| Entry | Use |
|-------|-----|
| `@sorye/platform` | `signal`, `computed`, `createAppStore`, `connectKernel`, `createStandaloneKernel`, `kernel.emit` |
| `@sorye/platform/host` | Hub only: `createKernelHost`, `startKernelSync` |
| `@sorye/platform/react` | `KernelProvider`, `useKernel`, `useSignalValue` |
| `@sorye/platform/vue` | `useKernelSignal` (pass Vue's `shallowRef` / `onScopeDispose`) |
| `@sorye/platform/angular` | `kernelSignalSubscribable` for `toSignal()` |
| `@sorye/platform/lit` | `withKernelSignals` mixin |

Apps must not import each other. `kernel.emit({ type: 'event', ... })` posts to `POST /api/events`. `kernel.emit({ type: 'handoff', ... })` posts to `POST /api/handoffs` and sets `sourceAppId` from the mounted app. Hub still validates the body. `kernel.navigate({ appId, side })` dispatches `sorye:hub:open-app` when the shell is listening; otherwise it opens that app's `mountPath`.

**Standalone.** `connectKernel` without a mount context (or `?standalone=1`) builds a local client and polls `GET /api/workspace` and `GET /api/notifications`. Set `VITE_HUB_ORIGIN=http://localhost:3000` when the document origin is the Vite port. Cookies stay the Hub session (`credentials: 'include'`). In development, Hub reflects CORS only for `http://localhost:<port>` and `http://127.0.0.1:<port>`. Production does not. Serve standalone behind the Hub origin (or a reverse proxy that forwards `/api`) so the call is first-party. `workspaceId` is never taken from the client. Standalone `navigate` needs `VITE_HUB_ORIGIN`; split panes exist only in the shell. Tasks (`apps/tasks`) is the reference remote.

**React** (what Hub and current remotes use):

```tsx
import { connectKernel, createAppStore } from '@sorye/platform';
import { KernelProvider, useKernel, useSignalValue } from '@sorye/platform/react';

const ui = createAppStore('tasks', { searchQuery: '' });

function Screen() {
  const kernel = useKernel();
  const workspaceName = useSignalValue(kernel.signals.workspaceName);
  const searchQuery = useSignalValue(ui.state.searchQuery);
  return <p>{workspaceName} {searchQuery}</p>;
}
```

`useSignalValue` subscribes with React `useSyncExternalStore`.

**Vue** — call inside `setup()`. Vue is not installed for Hub.

```ts
import { onScopeDispose, shallowRef } from 'vue';
import { useKernelSignal } from '@sorye/platform/vue';

const workspaceName = useKernelSignal(kernel.signals.workspaceName, {
  shallowRef,
  onScopeDispose,
});
```

**Angular** — `@angular/core` is not a dependency of Hub. Bridge into `toSignal` from an injection context:

```ts
import { toSignal } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import { kernelSignalSubscribable } from '@sorye/platform/angular';

const workspaceName = toSignal(
  kernelSignalSubscribable(kernel.signals.workspaceName) as Observable<string | null>,
  { requireSync: true },
);
```

**Lit** — mixin, no `lit` dependency on the platform package:

```ts
import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { withKernelSignals } from '@sorye/platform/lit';

@customElement('sorye-demo')
class SoryeDemo extends withKernelSignals(LitElement) {
  kernel!: KernelClient;
  override connectedCallback(): void {
    super.connectedCallback();
    this.watchKernelSignal(this.kernel.signals.workspaceName);
  }
  override render() {
    return html`${this.kernel.signals.workspaceName.value ?? ''}`;
  }
}
```

Private app state should be signals (`createAppStore` / `signal` / `computed`), not a second global store. The kernel lists mounted apps with `framework: 'react' | 'vue' | 'angular' | 'lit'` (remotes today are `react`). It does not read private fields.

### Storage

| Layer | Live data |
|-------|-----------|
| Postgres (`STORE_DRIVER=postgres`) | Users, workspaces, Messenger, Canvas, Tasks / Notes / Calendar (`workspace_app_docs`), OCR Qwen readings (`ocr_analyses`) |
| Hub `.data` on disk | Relay, events, notifications, handoffs, Mail, Storefront, Site, reports, Drive metadata and bytes (`.data/files/{workspaceId}/{uuid}`) |
| Browser | Temporary UI only |

Production refuses `STORE_DRIVER=json` and `AUTH_DEV_BYPASS`. Local JSON mode is for dev only.

## Containers

`docker-compose.yml` runs **Postgres 16** (`pnpm db:up`, volume `sorye_pg_data`, `localhost:5432`). The Qwen3-8B service is profile `qwen`: image `vllm/vllm-openai`, model `Qwen/Qwen3-8B`, container `sorye-qwen3-8b`, port `8000`, volume `sorye_qwen3`. It needs an NVIDIA GPU. Hub, remotes, Relay, mail, and Drive still run on the host. `fly.toml` points at `apps/hub/Dockerfile`, which is not in the repo yet.

Add containers beside the existing Postgres service. Do not add an API process per app.

| Service | Role | Status |
|---------|------|--------|
| `postgres` | OLTP for users, workspaces, Messenger, Canvas, Tasks / Notes / Calendar, OCR analyses | Live |
| `qwen3` | `Qwen/Qwen3-8B` for OCR pattern JSON. Profile `qwen`. Hub calls `OCR_LLM_BASE_URL` (default `http://127.0.0.1:8000`) | Live |
| `hub` | Next.js kernel: session, catalog, every `/api/*`. One replica (Canvas presence is in-memory). Mount `apps/hub/.data` or Relay, mail, and Drive disappear on recreate | Next |
| One nginx image per remote | Static `dist/` on today’s Vite port. `NEXT_PUBLIC_*_REMOTE` is fixed at Hub **build** time and must be a browser URL (`http://localhost:3005/remoteEntry.js`), not a Docker DNS name | Next |
| MinIO | Drive bytes. Database keeps metadata only | Later |
| Mail worker | Same Node image, other command. IMAP sync and SMTP send must not block Hub requests. Not a public mail server | Later |

Leave Google OAuth, Sentry, Stripe, and the user’s IMAP/SMTP host outside Compose. When Hub grows past one replica, fan out Relay and Canvas SSE with Postgres `LISTEN/NOTIFY`. Do not add Redis or a second language before that.

From the host, `DATABASE_URL` uses `localhost`. From the Hub container it uses hostname `postgres`.

### Boot order

1. `pnpm db:up`, set `STORE_DRIVER=postgres` and `DATABASE_URL`, run `pnpm db:push`. Confirm Tasks / Notes / Calendar survive a Hub restart.
2. Hub image plus a volume on `apps/hub/.data`. Point `DATABASE_URL` at `postgres:5432`. Confirm `POST /api/events` still lands in Relay on that volume.
3. One remote image (Tasks, port 3005). Load it from Hub and emit one workspace event.
4. Repeat for the other remotes. Hub-native apps stay in the Hub container.
5. MinIO, then move Drive bytes off `.data/files`.
6. Mail worker with `MAIL_SECRET_KEY` (falls back to `AUTH_SECRET` until then).
7. Postgres `LISTEN/NOTIFY` only when a second Hub replica is actually required.

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
| Kernel / app signals | `packages/platform`, `apps/hub/components/hub-kernel.tsx` |
| Security helpers | `apps/hub/lib/security.ts` |
| Per-app behavior | `docs/apps/APPS.md` |

See also: [SECURITY.md](./SECURITY.md), [apps/APPS.md](./apps/APPS.md).
