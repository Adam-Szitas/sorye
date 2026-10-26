# Sorye Apps — Index

Detailed reference for every app in the catalog. For platform-wide design, see [../ARCHITECTURE.md](../ARCHITECTURE.md). The same flows are drawn at `/architecture`.

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
| `components/mail-account-dialog.tsx` | Add Gmail / Outlook / IMAP account |
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
| `src/dashboard-data.ts` | Workspace metrics from Hub APIs |
| `src/embed-guide.tsx`, `database-guide.tsx` | Integration docs |
| `src/mount.tsx` | MF entry |

## Communications

- **Outbound:** `PATCH /api/events` to enable/disable workspace events
- **Inbound:** `GET /api/tasks`, `/api/notes`, `/api/calendar` for overview counts (migrates leftover browser localStorage once if the server doc is empty)
- **Relay:** Indirect — turning events on unlocks Relay + Messenger `#events`

## Dependencies

Hub session. Task / note / calendar counts come from Hub, not browser storage.

---

# Calendar

**Path:** `apps/calendar/`  
**Port:** 3003  
**Category:** Productivity  

## Purpose

Month-view scheduling. Events are workspace-scoped on Hub (`GET`/`PUT /api/calendar`). A one-time migrate copies leftover `sorye:calendar:events` localStorage when the server doc is empty.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Calendar UI |
| `src/calendar-storage.ts` | Hub API client + month grid helpers |
| `src/emit-event.ts` | `sorye.calendar.saved` → `/api/events` |
| `src/mount.tsx` | MF entry |

## Communications

- **Emits:** `sorye.calendar.saved` when user saves an event (if App events on → Relay → Messenger `#events`)
- **Handoffs:** None
- **Hub APIs:** `GET`/`PUT /api/calendar`, `POST /api/events`

---

# Notes

**Path:** `apps/notes/`  
**Port:** 3004  
**Category:** Productivity  

## Purpose

Lightweight note editor. Notes are workspace-scoped on Hub (`GET`/`PUT /api/notes`). A one-time migrate copies leftover `sorye:notes:items` localStorage when the server doc is empty. Selected note stays in memory.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Notes list + editor |
| `src/notes-storage.ts` | Hub API client + localStorage migrate |
| `src/emit-event.ts` | `sorye.notes.saved` |
| `src/mount.tsx` | MF entry |

## Communications

- **Emits:** `sorye.notes.saved` on save
- Same event/Relay pipeline as Calendar
- **Hub APIs:** `GET`/`PUT /api/notes`, `POST /api/events`

---

# Tasks

**Path:** `apps/tasks/`  
**Port:** 3005  
**Category:** Productivity  

## Purpose

Kanban board with configurable workflow columns. Drag-and-drop cards; status editor for column names/order. The board is workspace-scoped on Hub (`GET`/`PUT /api/tasks`). A one-time migrate copies leftover `sorye:tasks:board` localStorage when the server doc is empty. Search, the new-task field, and the board/statuses tab are private signals (`@sorye/platform` `createAppStore`). The header reads workspace name and user display name from the kernel. Events go through `kernel.emit` → `POST /api/events`.

Opened from Hub, `mount(container, { kernel })` uses the shell kernel. Opened on port 3005 (Vite `index.html`), the same entry uses a standalone kernel. Set `VITE_HUB_ORIGIN=http://localhost:3000` so that tab can send the Hub session cookie. `?standalone=1` forces the standalone client even when Hub passed a kernel.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Board + card UI |
| `src/tasks-ui.ts` | Private signal store (search, tab, new-task field) |
| `src/tasks-storage.ts` | Hub API client + localStorage migrate |
| `src/emit-event.ts` | `kernel.emit` for `sorye.task.created`, `updated`, `moved` |
| `src/mount.tsx` | MF entry. Accepts the Hub kernel or connects standalone |
| `src/hub-origin.ts` | Reads `VITE_HUB_ORIGIN` |

## Communications

- **Emits:** Task lifecycle events (high-signal for Relay)
- **Typical Relay route:** Tasks → Messenger `#events`
- **Hub APIs:** `GET`/`PUT /api/tasks`, `POST /api/events` (via `kernel.emit`). On port 3005 those URLs are prefixed with `VITE_HUB_ORIGIN` when it differs from the page origin.

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
- **Cloud storage:** Admins can connect AWS S3 or Cloudflare R2. Credentials are encrypted in Hub `.data/relay-storages.json` with the server-only `STORAGE_SECRET_KEY`; provider secrets never enter Relay config or browser storage. Explicit credential reveal is admin-only and no-store. Other workspace members can browse, upload, and download through Drive.

### Cloud storage setup

Use a dedicated provider access key scoped to one bucket. Hub validates access with `HeadBucket`; Relay then stores the credential using AES-256-GCM. AWS permissions needed for current Drive actions are `s3:ListBucket`, `s3:GetObject`, and `s3:PutObject`; no object-delete permission is used. R2 uses its account ID and S3-compatible API token. Do not use personal root credentials. Configure `STORAGE_SECRET_KEY` in the Hub host's secret manager before connecting a provider. This runtime-managed vault is intentionally separate from process environment variables, which cannot safely be edited by a UI while the server is running.

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
| `GET` | Bootstrap channels and members (no message history) |
| `GET /api/messenger/messages` | Page of messages for a channel (`limit` default 30, max 50; `before`/`cursor` message id for older; `after` ISO for newer poll). Returns `{ messages, hasMore }` |
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

Image messages validated server-side (`data:image/*;base64` only). Rendered as `<img>` without clickable `href`. Message pages cap `limit` at 50 (default 30); `before`/`cursor`/`after` are validated.

---

# Mail

**Path:** Hub-native (`apps/hub/components/app-mail.tsx`) — not a Vite remote  
**Catalog id:** `mail`  
**Status:** `available`  
**Plan slot:** optional (not `alwaysAvailable`) — enable from App Library, then open from the launcher.

## Purpose

Default **Sorye Mail** address (`{user-slug}@{workspace-slug}.mail.sorye`) is an in-workspace mailbox — Hub delivery, not a public MX. Members can also **Add account** to connect Gmail, Outlook/Hotmail, or custom IMAP/SMTP (app password). Hub fetches and sends by talking to the user’s provider. Optional personal email stays on the owner’s profile only.

## Key files

| File | Purpose |
|------|---------|
| `packages/types/src/apps.ts` | Catalog entry |
| `packages/types/src/mail.ts` | Message, profile, connected accounts, compose event |
| `apps/hub/components/app-mail.tsx` | 3-pane mailbox (accounts/folders \| list \| reading) |
| `apps/hub/components/mail-compose-dialog.tsx` | Compose modal (paste + file image; From = selected account) |
| `apps/hub/components/mail-account-dialog.tsx` | Add Gmail / Outlook / IMAP account |
| `apps/hub/lib/mail.ts` | JSON store (`.data/mail.json`) — workspace isolation |
| `apps/hub/lib/mail-imap.ts` | IMAP fetch + SMTP send (server-side) |
| `apps/hub/app/api/mail/route.ts` | `GET/POST/PATCH /api/mail` |
| `apps/hub/app/api/mail/accounts/` | List/add/remove/sync/read/send connected accounts |
| `apps/hub/app/api/mail/draft/route.ts` | `POST /api/mail/draft` |
| `apps/hub/app/api/mail/forward/route.ts` | `POST /api/mail/forward` (Messenger) |

## Communications

- `GET /api/mail` — profile, members (generated addresses only), inbox, sent, draft, connected accounts (no secrets)
- `POST /api/mail` — send in-workspace; emits `sorye.mail.sent`
- `PATCH /api/mail` — personal email + “also notify Messenger”
- `GET/POST /api/mail/accounts` — list / add (tests IMAP+SMTP, then encrypts the app password)
- `DELETE /api/mail/accounts/:id` — disconnect
- `POST /api/mail/accounts/:id/sync` — IMAP Inbox / Sent / Drafts
- `GET /api/mail/accounts/:id/messages` — cached headers
- `GET /api/mail/accounts/:id/messages/:messageId` — fetch body via IMAP
- `POST /api/mail/accounts/:id/send` — SMTP as that account; emits `sorye.mail.sent`
- `POST /api/mail/draft` / `POST /api/mail/forward` — prefill compose from Messenger (Sorye mailbox)
- Relay source `mail`; Hub event `sorye:mail:compose` opens the compose modal
- Images: `data:image/(jpeg|png|webp|gif);base64` + size cap (same as Messenger)
- Gmail/Outlook v1 uses IMAP + app password. OAuth is not wired (no Google/Microsoft mail client IDs).

---

# Drive

**Path:** Hub-native (`apps/hub/components/app-files.tsx`) — not a Vite remote  
**Catalog id:** `files`  
**Status:** `available`  
**Plan slot:** optional (not `alwaysAvailable`) — enable from App Library, then open from the launcher.

## Purpose

Workspace file locker. Members upload, search, preview, list, rename, download, and delete files for **this workspace only**. Bytes live on Hub disk; the JSON store holds metadata (id, workspaceId, displayName, relative path, mime, size, timestamps). Rename updates `displayName` only — the on-disk uuid never changes. Search is a client-side filter of the fetched list (plain, `/regex/`, `type:pdf` / `type:image`). Open/preview is limited to raster images, PDF, and text — Office stays download-only.

Connected cloud storage appears as named virtual folders here. Browsing, uploads, and downloads are proxied through Hub so provider credentials stay server-side; cloud objects remain in the provider bucket and are not copied into local Drive. Current providers are AWS S3 and Cloudflare R2.

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
| `apps/hub/lib/cloud-storage.ts` | Provider adapter, workspace-isolated connection vault, and object operations |
| `apps/hub/app/api/relay/storages/**` | Admin connection management and authenticated Drive object proxy |

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

Upload PDF → browser layout matrix (columns/rows) for review, CSV, or Protocolio.

**Analyze with Qwen** uploads the same PDF to Hub. Node reads each page as **one list of visible lines** (no column matrix) and flattens those lines into one document-wide line vector with page offsets. Each stored line is the text on the page, including spaces, digits, and units; a figure with no text is `[IMAGE]`. Hub stores that listing first (`status: extracting`), then asks Qwen3 8B for pattern JSON and updates the same row without rewriting the lines. When that row is finished, OCR shows a reading and links to `/apps/ocr/reading/{id}`. The PDF bytes are not stored. **Stored tables** searches the latest 50 extractions (`POST /api/ocr/analyses/query`) by UTC date, file name, JSON field name, code, and amount, without returning the page transcript. A table can be renamed with `PATCH /api/ocr/analyses/{id}`.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Upload UI, matrix preview, Analyze with Qwen |
| `src/ocr-engine.ts` | Tesseract + pdf.js pipeline (browser matrix) |
| `src/layout-matrix.ts` | Column detection (occupancy valleys, gutters) |
| `src/parse-document.ts` | Word extraction from PDF |
| `src/prepare-pdf.ts`, `prepare-image.ts`, `prepare-file.ts` | File prep |
| `src/to-pdf-template.ts` | Build Protocolio handoff payload |
| `src/send-to-protocolio.ts` | `POST /api/handoffs` |
| `src/emit-event.ts` | `sorye.ocr.analyzed`, `sorye.ocr.ready` |
| `src/mount.tsx` | MF entry |
| `apps/hub/lib/ocr/read-pdf.ts` | Node pdf.js reader → rows |
| `apps/hub/lib/ocr/rows.ts` | Visible lines and `[IMAGE]` |
| `apps/hub/lib/ocr/vector.ts` | Document-wide line vector and per-page completeness |
| `apps/hub/lib/ocr/analyze.ts` | Qwen prompt + pattern JSON |
| `apps/hub/app/api/ocr/analyze/route.ts` | Upload, read, store |
| `apps/hub/app/apps/ocr/reading/[id]/page.tsx` | Printable HTML reading of one stored analysis |
| `packages/types/src/ocr-ai.ts` | Row transcript + pattern contract |
| `packages/db` `ocr_analyses` | Postgres table |

## Processing model

The **layout matrix stays in the browser**. Analyze with Qwen sends the PDF to Hub (`POST /api/ocr/analyze`, 64 MB, 500 pages). Hub calls the `Qwen/Qwen3-8B` container in small slices. A slice that hits the output limit is split and read again. Long documents stay on `extracting` and continue through `POST /api/ocr/analyses/{id}/continue`. Hub writes `ocr_analyses`. With `STORE_DRIVER=json` the same record lands in `apps/hub/.data/ocr-analyses.json` until Postgres is on.

All three Hub settings (`OCR_LLM_PROVIDER`, `OCR_LLM_BASE_URL`, `OCR_LLM_MODEL`) are required, with no defaults. Hub checks the running server and configured model before inference. If configuration is missing/invalid or Qwen is down, the LLM is excluded and the lines are still stored (`status: "rows_only"`) and image markers are copied into the pattern JSON.

The OCR workspace uses shared SDK buttons and design tokens with its amber app accent. The upload/review/understand steps lead to a source preview and table review; library filters are collapsible. Completed readings, both embedded and on their own page, use the SDK's `DocumentTranscript` and `JsonDocument` components. Transcripts retain every source row and whitespace, grouped by page with line numbers. **Show AI-aligned JSON** reveals the full content document, with copy/download controls: aligned records, fields, patterns, math, images, and the complete page transcript. The export omits layout/font metadata and internal workspace/user identifiers; it uses `buildOcrReadingDocument` in `@sorye/types`, the same alignment as the visible table. Browser-only extraction has a separate **Show extracted JSON** control containing text and table rows, also without styling metadata.

UI regression check (OCR dev server on port 3011): `node scripts/test-ocr-ui.cjs`. This uses a mocked Hub response and does not call the LLM or persist documents.

## Qwen/Qwen3-8B in Docker

The checkpoint is `Qwen/Qwen3-8B` on Hugging Face. The container is vLLM's OpenAI server, which is the Docker path in the Qwen3 deployment docs. It listens on port 8000. An NVIDIA GPU must be visible to Docker. `pnpm db:up` does not start this service.

From the repo root, in PowerShell:

```powershell
docker compose --profile qwen pull qwen3
docker compose --profile qwen run --rm --entrypoint python qwen3 -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-8B')"
docker compose --profile qwen up -d qwen3
docker logs -f sorye-qwen3-8b
```

The second command downloads the Qwen3-8B weights into the `sorye_qwen3` volume. The third command loads those weights. First load takes a few minutes. Then:

```powershell
curl http://127.0.0.1:8000/v1/models
```

The model id in that response is `Qwen/Qwen3-8B`.

In `apps/hub/.env.local`:

```
STORE_DRIVER=postgres
DATABASE_URL=postgresql://sorye:sorye@localhost:5432/sorye
OCR_LLM_PROVIDER=vllm
OCR_LLM_BASE_URL=http://127.0.0.1:8000
OCR_LLM_MODEL=Qwen/Qwen3-8B
```

Create the table (includes `ocr_analyses`):

```powershell
pnpm db:push
```

Hub on the host uses `127.0.0.1`. Hub inside Compose uses `http://qwen3:8000`. `OCR_LLM_BASE_URL` is allowlisted to `localhost`, `127.0.0.1`, `::1`, `qwen3`, and `host.docker.internal`. Set `HF_TOKEN` in the shell before the download if Hugging Face rate-limits you.

## Communications

- **Emits:** When the browser scan completes (`analyzed`) and when ready for Protocolio (`ready`). Analyze with Qwen emits `analyzed` again with the stored id.
- **Handoffs OUT:** `POST /api/handoffs` with `kind: 'pdf-template'` to Protocolio
- **Hub:** `POST /api/ocr/analyze`, `GET /api/ocr/analyses`, `GET /api/ocr/analyses/:id`
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

Domain models: apps, workspaces, events, relay, notifications, handoffs, messenger, canvas, tasks, notes, calendar, embed, OCR, Studio types. **Always import contracts from here** — do not duplicate in remotes.

## `@sorye/sdk`

Lit web components (`sorye-button`, `sorye-card`, …) + React wrappers. Design tokens for consistent UI across remotes. This is not the kernel client.

## `@sorye/platform`

Kernel client and signals (`packages/platform`). Global state is owned by Hub. Private app state stays in the app. Cross-app calls go through `kernel.emit` to existing Hub event and handoff routes. React, Vue, Angular, and Lit adapters are subpath exports. Tasks is the reference React remote. See `docs/ARCHITECTURE.md`.

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
