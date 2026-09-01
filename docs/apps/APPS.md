# Sorye Apps — Index

Detailed reference for every app in the catalog. For platform-wide design, see [../ARCHITECTURE.md](../ARCHITECTURE.md).

| App | Port | Type | Doc section |
|-----|------|------|-------------|
| Hub | 3000 | Next.js host | [Hub](#hub) |
| Catalog | — | Hub-native, always on | [Catalog](#catalog) |
| Dashboard | 3001 | MF remote | [Dashboard](#dashboard) |
| Calendar | 3003 | MF remote | [Calendar](#calendar) |
| Notes | 3004 | MF remote | [Notes](#notes) |
| Tasks | 3005 | MF remote | [Tasks](#tasks) |
| Relay | 3006 | MF remote | [Relay](#relay) |
| Protocolio | 3007 | MF remote | [Protocolio](#protocolio) |
| Canvas | 3008 | MF remote | [Canvas](#canvas) |
| DevKit | 3009 | MF remote | [DevKit](#devkit) |
| Messenger | 3010 | MF remote | [Messenger](#messenger) |
| OCR | 3011 | MF remote | [OCR](#ocr) |
| Studio | 3012 | MF remote | [Studio](#studio) |
| SUSM | — | External iframe | [SUSM](#susm) |
| ESPM | — | External iframe | [ESPM](#espm) |
| Storefront | — | Coming soon | [Storefront](#storefront) |
| Reports | — | Coming soon | [Reports](#reports) |

## Communication principles

Apps do **not** talk to each other directly. All cross-app flows go through **Hub**:

```
Micro-app  →  POST /api/events     →  Relay  →  Messenger / Webhook / Email*
Micro-app  →  POST /api/handoffs   →  Handoff store  →  Target app polls
Micro-app  →  fetch /api/messenger →  Chat (human)
Hub        →  record notification  →  Badges + toasts + bell
```

\* Email/WhatsApp queued, not live.

**Opt-in:** App events are **off by default**. User enables in Dashboard. Relay routes must be configured separately.

**Same-origin API:** Remotes use relative `/api/*` URLs with cookies — works when mounted in Hub or embed iframe on Hub origin.

---

# Hub

**Path:** `apps/hub/`  
**Package:** `@sorye/hub`  
**Role:** Platform shell, authentication, API backend, Module Federation host, embed host.

## Responsibilities

- Google OAuth sign-in and session management (callback `http://localhost:3000/api/auth/callback/google`; use a regular browser, not an embedded/debug Chrome)
- Local development: `AUTH_DEV_BYPASS=true` skips Google and auto-provisions a workspace user (never on Fly.io)
- Workspace CRUD (personal + team), subscription limits
- App launcher, split-pane workspace, dock, status bar
- All `/api/*` routes consumed by remotes
- Module Federation host (`MicroAppLoader`)
- Embed (`embed.js`, `/embed/[slug]`)
- Notification center, toasts, per-app badges
- Connections panel (REST keys, embed widgets)

## Key files

| File | Purpose |
|------|---------|
| `components/hub-shell.tsx` | Main UI orchestration |
| `components/micro-app-loader.tsx` | MF remote load/unmount |
| `components/app-launcher.tsx` | Home grid + badges |
| `lib/ensure-user.ts` | Session resolution (Google + embed) |
| `lib/store/` | User/workspace persistence |
| `lib/events.ts` | Event publish pipeline |
| `lib/relay.ts` | Multi-channel delivery |
| `lib/notifications.ts` | Notification store + unread counts |
| `lib/handoffs.ts` | Cross-app payload queue |
| `lib/security.ts` | SSRF, validation helpers |
| `middleware.ts` | Auth gate |

## APIs owned

All routes under `app/api/`. See [ARCHITECTURE.md](../ARCHITECTURE.md#key-api-routes-quick-reference).

## Communications

Hub is the **hub** (literal): it receives events, stores handoffs, posts to Messenger, records notifications, and serves data to all remotes. Remotes never bypass Hub for shared state.

---

# Catalog

**Path:** Hub-native (`apps/hub/components/app-catalog.tsx`) — not a Vite remote  
**Catalog id:** `catalog`  
**Always on:** `alwaysAvailable: true` — every workspace, no plan slot, cannot be removed  

## Purpose

Browse every entry in `APP_CATALOG` by category. Open installed apps or jump to the App Library to enable more.

## Key files

| File | Purpose |
|------|---------|
| `packages/types/src/apps.ts` | Source of truth (`APP_CATALOG`, `alwaysAvailable`) |
| `apps/hub/components/app-catalog.tsx` | Catalog UI |
| `.cursor/rules/app-catalog.mdc` | Agents must update the catalog when apps change |

## Communications

- Reads `GET /api/workspace` for installed ids
- Asks Hub to open apps via `sorye:hub:open-app`
- Asks Hub to open the picker via `sorye:hub:manage-apps`

---

# Dashboard

**Path:** `apps/dashboard/`  
**Port:** 3001  
**Category:** Analytics  
**Role:** Workspace overview and feature toggles.

## Purpose

First app users typically enable. Shows workspace metrics, embed/database integration guides, and the **App events** master switch.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main dashboard views |
| `src/events-guide.tsx` | Explains + toggles App events via `PATCH /api/events` |
| `src/dashboard-data.ts` | Static/demo metrics |
| `src/embed-guide.tsx`, `database-guide.tsx` | Integration docs |
| `src/mount.tsx` | MF entry |

## Communications

- **Outbound:** `PATCH /api/events` to enable/disable workspace events
- **Inbound:** None (read-only metrics except events toggle)
- **Relay:** Indirect — turning events on unlocks Relay + Messenger `#events`

## Dependencies

Hub session only. No local server state.

---

# Calendar

**Path:** `apps/calendar/`  
**Port:** 3003  
**Category:** Productivity  

## Purpose

Month-view scheduling. Users add events with title and time; saves persist in client state (demo-level persistence).

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Calendar UI |
| `src/emit-event.ts` | `sorye.calendar.saved` → `/api/events` |
| `src/mount.tsx` | MF entry |

## Communications

- **Emits:** `sorye.calendar.saved` when user saves an event (if App events on → Relay → Messenger `#events`)
- **Handoffs:** None
- **Hub APIs:** `POST /api/events` only

---

# Notes

**Path:** `apps/notes/`  
**Port:** 3004  
**Category:** Productivity  

## Purpose

Lightweight note editor. Create notes, auto-save content.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Notes list + editor |
| `src/emit-event.ts` | `sorye.notes.saved` |
| `src/mount.tsx` | MF entry |

## Communications

- **Emits:** `sorye.notes.saved` on save
- Same event/Relay pipeline as Calendar

---

# Tasks

**Path:** `apps/tasks/`  
**Port:** 3005  
**Category:** Productivity  

## Purpose

Kanban board with configurable workflow columns. Drag-and-drop cards; status editor for column names/order.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Board + card UI |
| `src/emit-event.ts` | `sorye.task.created`, `updated`, `moved` |
| `src/mount.tsx` | MF entry |

## Communications

- **Emits:** Task lifecycle events (high-signal for Relay)
- **Typical Relay route:** Tasks → Messenger `#events`
- State: primarily client-side in current implementation

---

# Relay

**Path:** `apps/relay/`  
**Port:** 3006  
**Category:** Communication  

## Purpose

Configuration UI for routing workspace events to Messenger, email, webhooks, WhatsApp. Shows delivery activity log.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Configure sources/channels/routes |
| `src/relay-api.ts` | `GET/PATCH/POST /api/relay` |
| `src/mount.tsx` | MF entry |

## Communications

- **Reads:** Relay config + event settings from Hub
- **Writes:** `PATCH /api/relay` (sources, channels, routes, quiet hours)
- **Test:** `POST /api/relay` with `action: 'test'` injects test message
- **Listens:** `BroadcastChannel('sorye-relay')` for live refresh when other apps emit events

## Channel behavior (server-side)

| Channel | Delivery |
|---------|----------|
| messenger | Posts to `#events` via `postSystemMessage` |
| webhook | HTTPS POST with event JSON (SSRF-protected) |
| email | Queued |
| whatsapp | Queued |

---

# Protocolio

**Path:** `apps/protocolio/`  
**Port:** 3007  
**Category:** Developer  

## Purpose

Visual PDF template builder. Presets, blocks, live PDF generation via external Protocolio API (Hub bridge in dev).

## Key files

| File | Purpose |
|------|---------|
| `src/components/PipelineGuide.tsx` | User guide |
| `src/handoff.ts` | Poll/consume OCR handoffs |
| `src/emit-event.ts` | `sorye.protocolio.generated` |
| `src/services/clientService.ts` | PDF generate + event emit |
| `src/mount.tsx` | MF entry |

## Hub bridge

- `POST /api/protocolio/generate` — proxies to `PROTOCOLIO_API_URL` with dev token
- `GET /api/protocolio/health` — health check (admin sees full details)

## Communications

- **Emits:** `sorye.protocolio.generated` after PDF creation
- **Handoffs IN:** Polls `GET /api/handoffs?targetAppId=protocolio&unconsumed=1`, loads `pdf-template` payload from OCR
- **Handoffs OUT:** None currently
- **Listens:** `BroadcastChannel('sorye-app-handoff')`

## OCR integration

User flow: OCR → Send to Protocolio → handoff created → Protocolio auto-loads template when open.

---

# Canvas

**Path:** `apps/canvas/`  
**Port:** 3008  
**Category:** Creative  

## Purpose

Collaborative whiteboard — sticky notes, shapes, drag editing. Realtime via Server-Sent Events.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Board list + editor |
| `src/board-canvas.tsx` | Canvas rendering |
| `src/canvas-api.ts` | `GET/POST /api/canvas/boards/*` |
| `src/mount.tsx` | MF entry |

## Hub APIs

| Route | Purpose |
|-------|---------|
| `/api/canvas/boards` | List/create boards |
| `/api/canvas/boards/[id]` | Board CRUD |
| `/api/canvas/boards/[id]/events` | SSE presence + updates |

## Communications

- **Events/Relay:** Not wired (could add `sorye.canvas.updated` later)
- **Storage:** Hub default or workspace-specific Postgres
- **Realtime:** In-memory pub/sub on Hub + SSE to clients

Team workspaces: members share boards on same workspace ID.

---

# DevKit

**Path:** `apps/devkit/`  
**Port:** 3009  
**Category:** Developer  

## Purpose

Developer sandbox — API explorer, embed lab, webhook simulator, integration logs. Helps integrators test Hub without curl.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Tabbed dev tools |
| `src/mount.tsx` | MF entry |

## Communications

- Exercises same Hub APIs as production integrations
- Does not emit workspace events by default
- Useful for validating embed keys and webhook endpoints

---

# Messenger

**Path:** `apps/messenger/`  
**Port:** 3010  
**Category:** Communication  

## Purpose

Workspace chat: public channels, DMs, image uploads (compressed client-side). **`#events`** channel receives system messages from Relay.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Channel list, message thread, image upload |
| `src/messenger-api.ts` | `/api/messenger` client + mark-read |
| `src/mount.tsx` | MF entry |

## Hub APIs

| Action | Purpose |
|--------|---------|
| `GET` | Bootstrap channels, members, messages |
| `POST action=message` | Send text/image |
| `POST action=dm` | Open DM |
| `POST action=channel` | Create public channel |
| `POST action=mark-read` | Update read cursor (badge clearing) |

## Communications

- **Inbound (system):** Relay posts to `#events` via `postSystemMessage` (server-side, not user API)
- **Outbound:** User messages stay in Messenger store
- **Badges:** Unread chat + `#events` merged into Hub launcher badge via `messenger-unread.ts`
- **Events feature flag:** Bootstrap response includes `events.eligible/enabled/alive`

## Security

Image messages validated server-side (`data:image/*;base64` only). Rendered as `<img>` without clickable `href`.

---

# OCR

**Path:** `apps/ocr/`  
**Port:** 3011  
**Category:** Productivity  

## Purpose

Upload PDF → per-page layout matrix (columns/rows from word positions) → CSV export or handoff to Protocolio for PDF generation.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Upload UI, matrix preview, actions |
| `src/ocr-engine.ts` | Tesseract + pdf.js pipeline |
| `src/layout-matrix.ts` | Column detection (occupancy valleys, gutters) |
| `src/parse-document.ts` | Word extraction from PDF |
| `src/prepare-pdf.ts`, `prepare-image.ts`, `prepare-file.ts` | File prep |
| `src/to-pdf-template.ts` | Build Protocolio handoff payload |
| `src/send-to-protocolio.ts` | `POST /api/handoffs` |
| `src/emit-event.ts` | `sorye.ocr.analyzed`, `sorye.ocr.ready` |
| `src/mount.tsx` | MF entry |

## Processing model

**100% client-side** — no PDF uploaded to Hub server. Privacy-friendly; large files can stress browser.

## Communications

- **Emits:** When scan completes (`analyzed`) and when ready for Protocolio (`ready`)
- **Handoffs OUT:** `POST /api/handoffs` with `kind: 'pdf-template'` to Protocolio
- **Typical Relay route:** OCR → Messenger `#events` + optional webhook

---

# Studio

**Path:** `apps/studio/`  
**Port:** 3012  
**Category:** Creative  
**Catalog id:** `studio`

## Purpose

Client-side WebGPU inspection stage for **mesh** files. Drop GLB, FBX, STL, OBJ, USDZ, DAE, 3DS, PLY, 3MF, or WRL and orbit / zoom / pan from every direction. Native STEP/IGES solids and Blender `.blend` files are rejected with an export hint — Studio does not triangulate B-rep or parse Blender DNA.

A built-in **Too-much monitor** refuses oversized files and shuts the GPU path down if the mesh or live frame time exceeds budget, so a heavy CAD dump cannot freeze the Hub tab.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Drop zone, HUD, wireframe / turntable / reset |
| `src/studio-stage.ts` | Three.js `WebGPURenderer`, OrbitControls, canvas resize, dispose |
| `src/load-model.ts` | Mesh loaders (GLB, FBX, STL, OBJ, USDZ, …) + sample part |
| `src/too-much.ts` | File / triangle / vertex / GPU-byte / frame-time budgets |
| `src/emit-event.ts` | `sorye.studio.loaded`, `sorye.studio.too_much` |
| `packages/types/src/studio.ts` | Limits and stats contracts |
| `src/mount.tsx` | MF entry |

## Processing model

**100% client-side** — files never leave the browser. Caps (see `packages/types/src/studio.ts`): 64 MB file, 1.25M triangles, 2.5M vertices, ~220 MB estimated GPU buffers, 40 ms frame with a 14-frame slow streak.

The viewer is Three.js WebGPU (not a Rust/WASM engine) so Hub Module Federation stays a normal Vite remote. Native STEP/IGES and `.blend` are not parsed.

WebGPU is required. There is no WebGL fallback; missing GPU surfaces a clear error.

## Communications

- **Emits:** `sorye.studio.loaded` after a model mounts; `sorye.studio.too_much` when the monitor trips
- **Handoffs:** none
- **Typical Relay route:** Studio → Messenger `#events` (opt-in)

---

# SUSM

**Catalog id:** `susm`  
**Type:** External iframe  
**URL:** `https://susm.vercel.app`

## Purpose

Embeds external SUSM product in Hub pane. No Sorye API integration.

## Implementation

`ExternalAppFrame` in Hub loads iframe from `AppCatalogEntry.external.url`.

## Communications

None with Sorye event/handoff pipeline. Isolated third-party origin.

---

# ESPM

**Catalog id:** `espm`  
**Type:** External iframe  
**URL:** `https://espm-beta.vercel.app`

Same pattern as SUSM — external beta product in iframe shell.

---

# Storefront

**Status:** `coming_soon`  
**Catalog only** — no `apps/storefront/` yet.

Planned: commerce storefront. Would likely emit order/inventory events via Relay when built.

---

# Reports

**Status:** `coming_soon`  
**Catalog only**.

Planned: scheduled exports. Natural pairing with Relay webhooks when implemented.

---

# Shared packages (used by apps)

## `@sorye/types`

Domain models: apps, workspaces, events, relay, notifications, handoffs, messenger, canvas, embed, OCR, Studio types. **Always import contracts from here** — do not duplicate in remotes.

## `@sorye/sdk`

Lit web components (`sorye-button`, `sorye-card`, …) + React wrappers. Design tokens for consistent UI across remotes.

## `@sorye/db`

Drizzle schema for Postgres. Used by Hub store driver, not directly by MF remotes.

---

# Event name reference

| Event | Source app |
|-------|------------|
| `sorye.task.created` | Tasks |
| `sorye.task.updated` | Tasks |
| `sorye.task.moved` | Tasks |
| `sorye.calendar.saved` | Calendar |
| `sorye.notes.saved` | Notes |
| `sorye.ocr.analyzed` | OCR |
| `sorye.ocr.ready` | OCR |
| `sorye.protocolio.generated` | Protocolio |
| `sorye.studio.loaded` | Studio |
| `sorye.studio.too_much` | Studio |
| `sorye.messenger.posted` | Messenger (optional) |
| `sorye.system.events_activated` | Hub (first enable) |
| `sorye.test.ping` | Relay test |

All names validated server-side in `POST /api/events`.
