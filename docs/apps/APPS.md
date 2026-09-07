# Sorye Apps — Index

Detailed reference for every app in the catalog. For platform-wide design, see [../ARCHITECTURE.md](../ARCHITECTURE.md).

| App | Port | Type | Doc section |
|-----|------|------|-------------|
| Hub | 3000 | Next.js host | [Hub](#hub) |
| Catalog | — | Hub-native, always on | [Catalog](#catalog) |
| Contact | — | Hub-native, public presentation | [Contact](#contact) |
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
| Storefront | — | Hub-native | [Storefront](#storefront) |
| Mail | — | Hub-native | [Mail](#mail) |
| Drive | — | Hub-native | [Drive](#drive) |
| Site | — | Hub-native, public section builder | [Site](#site) |
| Reports | — | Hub-native, admins only | [Reports](#reports) |

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
| `components/app-catalog.tsx` | Hub-native Catalog |
| `components/app-reports.tsx` | Hub-native Reports (admins) |
| `components/app-contact.tsx` | Public Contact page (try Protocolio / Canvas) |
| `components/app-storefront.tsx` | Hub-native Storefront (enquiry cart) |
| `components/app-mail.tsx` | Hub-native Mail mailbox + compose host |
| `components/app-files.tsx` | Hub-native Drive (workspace files) |
| `components/app-site.tsx` | Hub-native Site editor (section/block builder) |
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

# Contact

**Path:** Hub-native (`apps/hub/components/app-contact.tsx`) — not a Vite remote  
**Catalog id:** `contact`  
**Public route:** `/contact` (also `/apps/contact` → `/contact`) — middleware allows these without Google  
**Not a workspace app:** `presentationOnly: true` — hidden from customer dock, top bar, launcher, picker, and Catalog tiles. Catalog stays `alwaysAvailable`; Contact does not.

## Purpose

Presentation page for Sorye (smaller–mid ops automation). Visitors (logged out) use `/contact`. Logged-in customers (including `AUTH_DEV_BYPASS`) do not see Contact in OS chrome — open `http://localhost:3000/contact` for the same UI. **Try Protocolio** and **Try Canvas** open the real remotes. **Email** opens a form dialog; Send composes `mailto:` to the public address in `contact-copy.ts` (no mailer yet).

## Key files

| File | Purpose |
|------|---------|
| `packages/types/src/apps.ts` | Catalog entry (`presentationOnly`) |
| `apps/hub/app/contact/page.tsx` | Public page |
| `apps/hub/components/app-contact.tsx` | Contact UI |
| `apps/hub/components/contact-email-dialog.tsx` | Email form dialog |
| `apps/hub/lib/contact-copy.ts` | Offer, intro, and email copy |
| `apps/hub/middleware.ts` | `/contact` and `/apps/contact` are public |

## Communications

- Asks Hub to open Protocolio / Canvas via `sorye:hub:open-app` when already in a pane; on `/contact` navigates to those app routes (login if needed)
- Email: modal form → `mailto:` after Send (Relay email is queue-only; no Hub mailer)
- No events or handoffs
- No first-run `AppUsageGuide` (same as Protocolio and Canvas)

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
- **Forward to Mail:** One click on a message `POST /api/mail/forward` then dispatches `sorye:mail:compose` so Hub opens the compose modal (in-workspace send only)

## Security

Image messages validated server-side (`data:image/*;base64` only). Rendered as `<img>` without clickable `href`.

---

# Mail

**Path:** Hub-native (`apps/hub/components/app-mail.tsx`) — not a Vite remote  
**Catalog id:** `mail`  
**Status:** `available`  
**Plan slot:** optional (not `alwaysAvailable`) — enable from App Library, then open from the launcher.

## Purpose

In-workspace mailbox. Each member gets a stable **Sorye Mail address** (`{user-slug}@{workspace-slug}.mail.sorye`) stored server-side. This is Hub delivery, not a public MX / SMTP inbox. Optional personal email stays on the owner’s profile only.

## Key files

| File | Purpose |
|------|---------|
| `packages/types/src/apps.ts` | Catalog entry |
| `packages/types/src/mail.ts` | Message, profile, compose event |
| `apps/hub/components/app-mail.tsx` | Inbox / Sent list + reading pane; settings in header |
| `apps/hub/components/mail-compose-dialog.tsx` | Compose modal (paste + file image) |
| `apps/hub/lib/mail.ts` | JSON store (`.data/mail.json`) |
| `apps/hub/app/api/mail/route.ts` | `GET/POST/PATCH /api/mail` |
| `apps/hub/app/api/mail/draft/route.ts` | `POST /api/mail/draft` |
| `apps/hub/app/api/mail/forward/route.ts` | `POST /api/mail/forward` (Messenger) |

## Communications

- `GET /api/mail` — profile, members (generated addresses only), inbox, sent, draft
- `POST /api/mail` — send in-workspace; emits `sorye.mail.sent`
- `PATCH /api/mail` — personal email + “also notify Messenger”
- `POST /api/mail/draft` / `POST /api/mail/forward` — prefill compose from Messenger
- Relay source `mail`; Hub event `sorye:mail:compose` opens the compose modal
- Images: `data:image/(jpeg|png|webp|gif);base64` + size cap (same as Messenger)

---

# Drive

**Path:** Hub-native (`apps/hub/components/app-files.tsx`) — not a Vite remote  
**Catalog id:** `files`  
**Status:** `available`  
**Plan slot:** optional (not `alwaysAvailable`) — enable from App Library, then open from the launcher.

## Purpose

Workspace file locker. Members upload, search, preview, list, rename, download, and delete files for **this workspace only**. Bytes live on Hub disk; the JSON store holds metadata (id, workspaceId, displayName, relative path, mime, size, timestamps). Rename updates `displayName` only — the on-disk uuid never changes. Search is a client-side filter of the fetched list (plain, `/regex/`, `type:pdf` / `type:image`). Open/preview is limited to raster images, PDF, and text — Office stays download-only.

## Storage

- Disk: `apps/hub/.data/files/{workspaceId}/{uuid}` (uuid is the storage filename)
- Metadata: `apps/hub/.data/files-meta.json` — no file bytes
- `workspaceId` from `ensureHubUser()` only. Paths are `workspaceId + uuid`; user-supplied path segments, `..`, and absolute paths are rejected. Download/delete resolve the path and require it stay under that workspace directory.

## Key files

| File | Purpose |
|------|---------|
| `packages/types/src/apps.ts` | Catalog entry |
| `packages/types/src/files.ts` | Metadata contract + size caps + inline-preview allowlist |
| `apps/hub/components/app-files.tsx` | List, search, preview, upload, rename, download, delete |
| `apps/hub/lib/file-search.ts` | Client-side name / regex / type-token filter |
| `apps/hub/lib/file-preview.ts` | Inline-preview mime allowlist |
| `apps/hub/lib/files.ts` | Disk + metadata store + disposition helper |
| `apps/hub/app/api/files/route.ts` | `GET/POST /api/files` |
| `apps/hub/app/api/files/[id]/route.ts` | `GET/PATCH/DELETE /api/files/[id]` |

## Communications

- `GET /api/files` — list this workspace’s files
- `POST /api/files` — multipart upload; emits `sorye.files.uploaded`
- `PATCH /api/files/[id]` — rename (`displayName` only)
- `GET /api/files/[id]` — download (`Content-Disposition: attachment`). `?inline=1` uses `inline` only for raster images, PDF, and text/csv/markdown/json — never HTML/SVG/script. Office binaries stay attachment.
- `DELETE /api/files/[id]` — delete disk file + metadata row
- Relay source `files`; Reports can count `sorye.files.uploaded`

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

**Path:** Hub-native (`apps/hub/components/app-storefront.tsx`) — not a Vite remote  
**Catalog id:** `storefront`  
**Status:** `available`  
**Plan slot:** optional (not `alwaysAvailable`) — enable from App Library, then open from the launcher.

## Purpose

Workspace members browse a small seed catalog of SMB/ops kits, add them to a cart, and place an **enquiry / order request**. No Stripe. Orders persist per workspace in Hub JSON (`.data/storefront-*.json`). `workspaceId` comes from `ensureHubUser()` only.

## Key files

| File | Purpose |
|------|---------|
| `packages/types/src/apps.ts` | Catalog entry |
| `packages/types/src/storefront.ts` | Product/order types + seed copy |
| `apps/hub/components/app-storefront.tsx` | Shop, cart, my orders |
| `apps/hub/lib/storefront.ts` | JSON store |
| `apps/hub/app/api/storefront/products/route.ts` | `GET/POST /api/storefront/products` |
| `apps/hub/app/api/storefront/orders/route.ts` | `GET/POST /api/storefront/orders` |

## Communications

- `GET /api/storefront/products` — seeds six kits on first visit
- `POST /api/storefront/products` — upsert a product for this workspace (size-capped)
- `GET /api/storefront/orders?mine=1` — current user’s order requests
- `POST /api/storefront/orders` — place enquiry; emits `sorye.storefront.order_placed`
- Relay source `storefront`; Reports funnel includes order_placed

---

# Site

**Path:** Hub-native (`apps/hub/components/app-site.tsx`) — not a Vite remote  
**Catalog id:** `site`  
**Editor:** `/apps/site` (enable Site from the App Library, then open from the launcher)  
**Public route:** `/s/[slug]` — middleware allows this without Google. Unpublished or unknown slug → 404.

## Purpose

A shareable **section/block** page for **this workspace**. Logged-in members add, reorder, or remove blocks and toggle **Published**. Visitors with the URL see only those published blocks — never Reports, Mail, members, events, or storefront orders.

**Block types:** Hero (heading, offer, CTA), About (length-capped text), Links (https), Storefront (this workspace’s product names/prices), Contact (button to `/contact` or mailto). Optional hero image URLs are https-only (`assertSafePublicHttpsUrl`); unsafe URLs are skipped.

Starters: Company landing, Shop-front, Hiring. Slug is derived from the workspace name plus a stable id suffix (not user-controlled). `workspaceId` on write comes from `ensureHubUser()` only. The public page loads storefront products on the Hub server from the slug → workspace map — never from a client `workspaceId`.

## Key files

| File | Purpose |
|------|---------|
| `packages/types/src/apps.ts` | Catalog entry |
| `packages/types/src/site.ts` | Block types, templates, length caps |
| `apps/hub/components/app-site.tsx` | Section builder + copy URL |
| `apps/hub/components/site-public-view.tsx` | Public block renderer |
| `apps/hub/lib/site.ts` | JSON store (`.data/site-pages.json`) |
| `apps/hub/app/api/site/route.ts` | `GET/PUT /api/site` |
| `apps/hub/app/s/[slug]/page.tsx` | Public page |
| `apps/hub/middleware.ts` | `/s/[slug]` is public |

## Communications

- `GET /api/site` — draft or saved page for the session workspace
- `PUT /api/site` — save `displayName` + `blocks`; first publish emits `sorye.site.published`
- Public `GET /s/[slug]` — published blocks only; lookup by slug; storefront products attached server-side
- Relay source `site`; Reports funnel includes `sorye.site.published`
- No first-run `AppUsageGuide`

---

# Reports

**Path:** Hub-native (`apps/hub/components/app-reports.tsx`) — not a Vite remote  
**Catalog id:** `reports`  
**Always on for admins:** `alwaysAvailable: true` + `adminOnly: true` — no plan slot; hidden from member launcher, dock, picker, and Catalog tiles.

## Purpose

Workspace-scoped operational graphs for platform admins (`ADMIN_EMAILS` / `HubUser.isAdmin`). Counts come from Hub `POST /api/events` (day buckets + allowlisted names + app ids) and failed Relay deliveries for **this workspace only**. No raw event payloads, summaries, or message bodies.

## Key files

| File | Purpose |
|------|---------|
| `packages/types/src/apps.ts` | Catalog entry (`adminOnly`) |
| `packages/types/src/reports.ts` | Snapshot contract |
| `apps/hub/components/app-reports.tsx` | Charts UI |
| `apps/hub/app/api/reports/route.ts` | `GET /api/reports` |
| `apps/hub/lib/reports.ts` | Count-only index (`report-stats.json`) |
| `apps/hub/lib/platform-admin.ts` | Admin gate |

## Communications

- `GET /api/reports?days=7|14|30|90` — session cookie; `workspaceId` from `ensureHubUser()`
- Reads event stats recorded on `POST /api/events`
- Failed-delivery counts from existing Relay activity (no extra payload log)

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
| `sorye.storefront.order_placed` | Storefront |
| `sorye.site.published` | Site |
| `sorye.mail.sent` | Mail |
| `sorye.files.uploaded` | Drive |
| `sorye.system.events_activated` | Hub (first enable) |
| `sorye.test.ping` | Relay test |

All names validated server-side in `POST /api/events`.
