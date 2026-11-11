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
| Storefront | — | Hub-native | [Storefront](#storefront) |
| Mail | — | Hub-native | [Mail](#mail) |
| Drive | — | Hub-native | [Drive](#drive) |
| Site | — | Hub-native, public section builder | [Site](#site) |
| Forms | — | Hub-native, public form builder | [Forms](#forms) |
| Reports | — | Hub-native, admins only | [Reports](#reports) |

Not an app: the [administration console](#administration-console) at `admin.sorye.app` (Hub `/admin` routes). It replaced the retired Operator app.

## Durable data cutover status

The intended boundary is **app → Hub → Rodrigo**. Hub remains the browser-facing session, authorization, validation, and API layer; apps do not call Rodrigo or databases directly. The cutover is partial and pre-production. See the [durable contract status](../RODRIGO-DATA-CONTRACT.md) and [switching runbook](../RODRIGO-DATABASE-SWITCHING-RUNBOOK.md).

| App or slice | Current durable path | Remaining coverage |
|---|---|---|
| Tasks, Notes, Calendar | Hub v2 actions and reads; app-owned scoped IndexedDB queues; old resource mutation endpoints disabled | Calendar/Notes event notifications still use Hub; end-to-end outage/restart certification remains required |
| Canvas | Rodrigo v2 board resources and queued mutations | Realtime invalidation remains Hub-owned; nested payload validation and app-specific end-to-end coverage remain |
| Site | Rodrigo v2 page editing, queued mutations, and anonymous published reads | Relay publish events are not emitted. Unpublished and unknown slugs are 404 |
| Storefront | Rodrigo v2 product resources, enquiry creates, and queued mutations | Status transitions are not a Hub workflow. Seed products cannot be ordered |
| Forms | Rodrigo v2 form definitions, slug index, anonymous submissions, queued member mutations | No submission notification or event; no file uploads, quotas or close dates; end-to-end browser coverage remains |
| Workspace profile | Rodrigo v2 profile read and name update | Membership, app access, team settings, and other account policy remain Hub-owned |
| Messenger | Rodrigo v2 channels and text messages; channel-authorized timeline reads and queued writes | Attachments, read receipts, reactions if enabled, and event delivery remain uncovered |
| All other catalog apps and Hub-native features | Existing Hub or app-specific paths | Not yet migrated; do not treat their data as Rodrigo-authoritative |

The table records active implementation slices, not rollout certification. Each app is complete only when every durable write/read path, its authorization boundary, retries/conflicts, outage behavior, and disposable-PostgreSQL end-to-end checks are covered.

## Personal and Work lists

A member who belongs to a personal workspace and one or more team workspaces sees those two sections inside the app. The lists come from `partitionUserLoad` in `apps/hub/lib/user-load.ts`. Hub builds the groups from `session.workspaces` and rechecks each id with `getHubSessionForWorkspace`. The client does not send a workspace id for the read. `mergeUserLoad` in the same file concatenates personal, then teams by name. List UIs do not call it and no response includes it.

Each row keeps its workspace id, name, and kind. The UI labels are **Personal** and **Work**. Several teams stay grouped by team name under Work. A side the user does not belong to is omitted. An empty side they do belong to shows a short empty state. Opening a row switches through `POST /api/workspace/team` when the row's workspace is not active, then reloads that item. New notes, events, channels, tasks, and uploads still write to the active workspace.

| App | List |
|-----|------|
| Messenger | Channels the user joined, or was invited to by a non-empty `memberIds` list. A channel with an empty `memberIds` list is workspace-open (`#general`, `#random`, `#events`); there is no invite table. Direct messages require membership. |
| Calendar | Events. |
| Notes | Notes. The editor still saves the active workspace document. |
| Tasks | Tasks from other workspaces are listed; the board remains the active workspace. |
| Drive | Files. The active workspace stays in the file table. |
| Notifications | Personal notices and team notices. Platform notices from the administration console stay on their own banner. |
| Relay | Messages. Config writes stay on the active workspace. |
| Canvas | Boards. Opening a board switches first; create and delete stay on the active workspace. |
| OCR | Library and search hits. No extra OCR job is started to build the list. |
| Dashboard | Recent activity and Work by app. Metric cards stay on the active workspace. |
| DevKit and Connections | Embed widgets. The embed iframe still runs only the widget key's workspace. |
| Mail | Sorye mailbox messages. Connected IMAP stays on the active account and is not synced for every workspace. |
| Storefront | The signed-in user's orders. The shop catalog stays on the active workspace. |
| Site | Saved pages. The editor stays on the active workspace and does not invent an empty draft for the other side. |
| Studio | Drive files whose `sourceAppId` is `studio`. |
| Protocolio | Browser drafts keyed by workspace id (`sorye:protocolio:draft:v1:<workspaceId>`). The old unscoped key is copied into the active workspace once. |
| Contact, Catalog | No member data. They do not render the two sections. |
| Reports | Active-workspace event charts. It has no member-activity list, so it is not split, and platform series are not added to it. |

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
- Signed Rodrigo discovery: authenticated `/api/backend/capabilities` and platform-admin-only `/api/backend/topology`. The live v2 slices are listed in the cutover table above; see [Rodrigo](../RODRIGO.md).
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
| `app/admin/**`, `components/admin/**`, `lib/admin/**` | Administration console (admin host only) |
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
| `middleware.ts` | Host classification (customer, admin, app, unknown), admin allowlist and redirects, write-origin check, auth gate |

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

Browse every entry in `APP_CATALOG` by category. Each sold app shows its yearly share of one stack's electricity. The shares sum to the yearly subscription that covers the shared host and the OCR GPU allowance. Catalog and Reports show as included. Open installed apps or jump to the App Library to enable more.

## Key files

| File | Purpose |
|------|---------|
| `packages/types/src/apps.ts` | Source of truth (`APP_CATALOG`, `alwaysAvailable`, `costWeight`) |
| `packages/types/src/running-cost.ts` | Yearly electricity floor and per-app split |
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

First app users typically enable. Shows workspace metrics, embed/database integration guides, the **App events** master switch, and a **Work by app** view.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Main dashboard views |
| `src/events-guide.tsx` | Explains + toggles App events via `PATCH /api/events` |
| `src/dashboard-data.ts` | Workspace metrics from Hub APIs |
| `src/work-analytics.tsx` | One headed section per app with work, stacked on the page. OCR stats stay in the OCR section; the job table is a separate OCR section under the other apps. Other apps show event counts only |
| `src/embed-guide.tsx`, `database-guide.tsx` | Integration docs |
| `src/mount.tsx` | MF entry |

## Communications

- **Outbound:** `PATCH /api/events` to enable/disable workspace events
- **Inbound:** `GET /api/tasks`, `/api/notes`, `/api/calendar` for overview counts (migrates leftover browser localStorage once if the server doc is empty)
- **Relay:** Indirect — turning events on unlocks Relay + Messenger `#events`
- **Work:** `GET /api/analytics` uses the session workspace. The Work by app view stacks one section per app that has data, each with that app’s name as a heading. OCR totals come from `ocr_analyses` (file name, status, page and row counts, model start/finish and duration) and the job table stays in its own OCR section. Other apps appear only when Hub already recorded their events, as counts. Empty apps are omitted.

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

Kanban board with configurable workflow columns. Drag-and-drop cards between columns; the status control on a card selects a column. Clicking a card stays on the board and opens a ticket dialog: the task id, summary, description, status, and images. The id is the task's existing board id (`task-` plus eight hex characters, or an older seed id such as `task-seed-1`). It is unique on that workspace board. Copy puts the id on the clipboard. A coworker with the same workspace membership and Tasks enabled opens it at `/apps/tasks?ticket=<id>` or by pasting the id into Open ticket. The query does not select a workspace. An unknown id, or a user without Tasks access, fails closed. The description accepts pasted text. Pasted or dropped images, up to eight JPEG/PNG/WebP/GIF files of 5 MB each, are Hub Drive files in the Tasks section (`sourceAppId: tasks`). The task stores `attachmentIds` only. A previously saved `driveFileId` is read as one image and rewritten as `attachmentIds` on the next board save. Rodrigo owns the board and does not store the bytes. The board is workspace-scoped: `GET /api/tasks` reads Rodrigo, and writes are v2 `taskBoard` actions. `PUT /api/tasks` is disabled. Search, the new-task field, the open-ticket field, and the board/statuses tab are private signals (`@sorye/platform` `createAppStore`). Events go through `kernel.emit` → `POST /api/events`.

Opened from Hub, `mount(container, { kernel })` uses the shell kernel. Opened on port 3005 (Vite `index.html`), the same entry uses a standalone kernel. Set `VITE_HUB_ORIGIN=http://localhost:3000` so that tab can send the Hub session cookie. `?standalone=1` forces the standalone client even when Hub passed a kernel.

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Board, card UI, and task editor |
| `src/task-editor.tsx` | Ticket dialog: id, summary, description, status, and images |
| `src/task-photo.ts` | Drive upload of task images into the Tasks section |
| `src/tasks-ui.ts` | Private signal store (search, tab, new-task field) |
| `src/tasks-storage.ts` | Queued Hub v2 task board client |
| `src/emit-event.ts` | `kernel.emit` for `sorye.task.created`, `updated`, `moved` |
| `src/mount.tsx` | MF entry. Accepts the Hub kernel or connects standalone |
| `src/hub-origin.ts` | Reads `VITE_HUB_ORIGIN` |

## Communications

- **Emits:** Task lifecycle events (high-signal for Relay)
- **Typical Relay route:** Tasks → Messenger `#events`
- **Hub APIs:** `GET /api/tasks` and `POST /api/backend/actions/batch` for the board. `PUT /api/tasks` returns 410. Task images use `POST /api/files` with `sourceAppId=tasks` and are shown from `GET /api/files/{id}?inline=1`. `POST /api/events` via `kernel.emit`. On port 3005 those URLs are prefixed with `VITE_HUB_ORIGIN` when it differs from the page origin. `/apps/tasks?ticket=<id>` opens that ticket in the current workspace.

---

# Relay

**Path:** `apps/relay/`  
**Port:** 3006  
**Category:** Communication  

## Purpose

Configuration UI for routing workspace events to Messenger, email, webhooks, WhatsApp. Shows delivery activity log.

The **Your storage** tab lets the owner of a Pro or Enterprise workspace connect their own S3-compatible drive or PostgreSQL database and send all new Drive uploads (Drive, Tasks photos, OCR PDFs) there. It shows what each field needs, the minimum permissions, used / free / limit space, and the upload record. Uploads never fall back to Sorye storage when the chosen storage is unreachable. Details and threat model: [OWN-STORAGE.md](../OWN-STORAGE.md).

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Configure sources/channels/routes |
| `src/relay-api.ts` | `GET/PATCH/POST /api/relay` |
| `src/own-storage.tsx`, `src/own-storage.css` | Your storage tab |
| `apps/hub/lib/upload-storage/*`, `apps/hub/app/api/own-storage/**` | Validation, network guard, drive and database adapters, settings and upload ledger, API |
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
- **Name ping:** Typing a name in the composer (with or without `@`) suggests people in that channel's workspace. Choosing one inserts `@[Name](userId)`. Sending notifies that person in the same Personal or Work scope and opens this channel. A personal ping is omitted when Messenger is not in that person's personal subscription.

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

Workspace file locker. Members upload, search, preview, list, rename, download, and delete files for **this workspace only**. JSON/Postgres stores metadata; bytes use local `.data` storage in development or the configured S3-compatible object store in production (id, workspaceId, displayName, relative path, mime, size, timestamps). Rename updates `displayName` only — the generated uuid object key never changes. Search is a client-side filter of the fetched list (plain, `/regex/`, `type:pdf` / `type:image`). Open/preview is limited to raster images, PDF, and text — Office stays download-only.

Connected cloud storage appears as named virtual folders here. Browsing, uploads, and downloads are proxied through Hub so provider credentials stay server-side; cloud objects remain in the provider bucket and are not copied into local Drive. Current providers are AWS S3 and Cloudflare R2.

## Storage

- Disk: `apps/hub/.data/files/{workspaceId}/{uuid}` (uuid is the storage filename)
- Task images use the same bytes and metadata, with `sourceAppId: tasks`, so Drive lists them in the Tasks section rather than the Drive root. A ticket stores up to eight of those file ids. Rodrigo does not store those bytes.
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

**Analyze with Qwen** uploads the same PDF to Hub. Node reads each page as **one list of visible lines** (no column matrix) and flattens those lines into one document-wide line vector with page offsets. Each stored line is the text on the page, including spaces, digits, and units; a figure with no text is `[IMAGE]`. Hub stores that listing first (`status: extracting`), then either asks the Hub Server GPU (`Qwen3 8B`) for pattern JSON or, when the user selects **My GPU (WebGPU)**, returns the stored rows so the browser WebGPU pipeline normalizes the table and submits the pattern to `PATCH /api/ocr/analyses/{id}/pattern` without rewriting the lines. When that row is finished, OCR shows a reading and links to `/apps/ocr/reading/{id}`. The PDF bytes are not stored. **Stored tables** searches the latest 50 extractions (`POST /api/ocr/analyses/query`) by UTC date, file name, JSON field name, code, and amount, without returning the page transcript. A table can be renamed with `PATCH /api/ocr/analyses/{id}`.

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
| `apps/hub/app/apps/ocr/reading/[id]/page.tsx` | Printable HTML reading of one stored analysis. Page chrome is `StandaloneAppBar` (language switcher and Hub menu link) from `packages/platform/src/chrome.tsx` |
| `packages/types/src/ocr-ai.ts` | Row transcript + pattern contract |
| `packages/db` `ocr_analyses` | Postgres table |

## Processing model

The **layout matrix stays in the browser**. Analyze with Qwen sends the PDF to Hub (`POST /api/ocr/analyze`, 64 MB, 500 pages). In Postgres mode that returns `202 { jobId }` and the OCR worker finishes the job even if the user leaves OCR. While OCR is mounted it polls `GET /api/jobs/:id`. When the job completes or fails, Hub writes a notification for the user who started it, in that workspace only. Clicking the notification opens OCR on the stored analysis (success) or the existing error (failure). Opening OCR again calls `GET /api/ocr/active`, which uses the server session and ignores a client workspace id: a finished job is shown immediately, and a still-running job resumes polling. Leaving OCR does not cancel the job. A client WebGPU pass finishes in the open browser tab; the patched analysis is what OCR shows if the user comes back within Hub. A transcript that fits the model context is one request. Longer documents are read in slices; a slice that hits the output limit is split and read again. Long documents stay on `extracting` and continue through `POST /api/ocr/analyses/{id}/continue`. Hub writes `ocr_analyses`. With `STORE_DRIVER=json` the same record lands in `apps/hub/.data/ocr-analyses.json` until Postgres is on.

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
- **Hub:** `POST /api/ocr/analyze` (`202 { jobId }` on Postgres), `GET /api/jobs/:id` while mounted, `GET/POST /api/ocr/active` to restore the latest session job, `GET /api/ocr/analyses`, `GET /api/ocr/analyses/:id`
- **Notifications:** job completion is recorded by the Hub worker, not by the OCR remote. The existing Hub notification center opens OCR with the analysis id.
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

# Storefront

**Path:** Hub-native (`apps/hub/components/app-storefront.tsx`) — not a Vite remote  
**Catalog id:** `storefront`  
**Status:** `available`  
**Plan slot:** optional (not `alwaysAvailable`) — enable from App Library, then open from the launcher.

## Purpose

Workspace members browse the workspace catalog, add saved products to a cart, and place an **enquiry**. No Stripe. Products and enquiries are Rodrigo v2 resources. The signed-in member is the order owner; the browser cannot choose that owner. Seed kits are display defaults until an owner saves them. `workspaceId` comes from `ensureHubUser()` only.

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

- `GET /api/storefront/products` — Rodrigo products, or the six seed kits when none are saved
- `POST /api/storefront/products` — disabled (410). Owners queue product edits
- `GET /api/storefront/orders` — current member’s `requested` enquiries, filtered by Rodrigo’s verified actor
- `POST /api/storefront/orders` — disabled (410). Members queue enquiry creates. Status changes and `sorye.storefront.order_placed` are not live
- Relay source `storefront` remains for other events; this enquiry path does not emit `order_placed`

---

# Site

**Path:** Hub-native (`apps/hub/components/app-site.tsx`) — not a Vite remote  
**Catalog id:** `site`  
**Editor:** `/apps/site` (enable Site from the App Library, then open from the launcher)  
**Public route:** `/s/[slug]` — middleware allows this without Google. Unpublished or unknown slug → 404.

## Purpose

A shareable **section/block** page for **this workspace**. Logged-in owners add, reorder, or remove blocks and toggle **Published**. Visitors with the URL see only those published blocks — never Reports, Mail, members, events, or storefront orders. The public read uses Rodrigo’s slug index and a reserved Hub service assertion.

**Block types:** Hero (heading, offer, CTA), About (length-capped text), Links (https), Storefront (this workspace’s product names/prices), Contact (button to `/contact` or mailto). Optional hero image URLs are https-only (`assertSafePublicHttpsUrl`); unsafe URLs are skipped.

Starters: Company landing, Shop-front, Hiring. Slug is derived from the workspace name plus a stable id suffix (not user-controlled). `workspaceId` on write comes from `ensureHubUser()` only. The public page loads storefront products on the Hub server from the slug → workspace map — never from a client `workspaceId`.

## Key files

| File | Purpose |
|------|---------|
| `packages/types/src/apps.ts` | Catalog entry |
| `packages/types/src/site.ts` | Block types, templates, length caps |
| `apps/hub/components/app-site.tsx` | Section builder + copy URL |
| `apps/hub/components/site-public-view.tsx` | Public block renderer |
| `apps/hub/lib/site.ts` | Public projection and legacy JSON helpers. `/s/[slug]` does not read the JSON store |
| `apps/hub/app/api/site/route.ts` | `GET/PUT /api/site` |
| `apps/hub/app/s/[slug]/page.tsx` | Public page |
| `apps/hub/middleware.ts` | `/s/[slug]` is public |

## Communications

- `GET /api/site` — Rodrigo page for the session workspace, or a local draft shape when none is saved
- `PUT /api/site` — disabled (410). Owners queue page edits, including the published flag
- Public `GET /s/[slug]` — published blocks only; slug lookup is signed with the reserved public-site grant; active USD product cards are attached when a shop block is present. Unknown, unpublished, and unsafe pages are 404. A Rodrigo outage is an unavailable page, not a Hub JSON fallback
- `sorye.site.published` is not emitted by this save
- No first-run `AppUsageGuide`

---

# Forms

**Path:** Hub-native (`apps/hub/components/app-forms.tsx`) — not a Vite remote  
**Catalog id:** `forms`  
**Editor:** `/apps/forms`  
**Public route:** `/f/[slug]` — no sign-in. Unpublished, deleted or unknown slug → 404.

## Purpose

Members build a form (short and long text, email, phone, number, date, dropdown, multiple choice, checkbox, consent), publish it at `/f/<slug>`, and read the answers. The builder shows a live preview beside the editor on wide screens and as a Preview tab on narrow ones; the preview sends nothing. On the public page, a dropdown with six choices or fewer shows as a list of choices to tap, and optional questions are marked instead of required ones. Each answer has a handling status (new, handled, spam), can be filtered by that status, and can be deleted or exported as CSV. Forms is Hub-native because its public page and anonymous routes are Hub routes, like Site; it has no remote, port or gateway, and it cannot be mounted through `/embed/`. The public page itself can be linked or framed.

Not provided: file-upload fields, conditional logic, close dates, submission quotas, CAPTCHA, and any notification or event when an answer arrives.

## Key files

| File | Purpose |
|------|---------|
| `packages/types/src/forms.ts` | Field kinds, definition and submission types, validators that mirror Rodrigo |
| `packages/platform/src/messages/forms.ts` | All Forms text in en, de, sk, hu, es |
| `apps/hub/components/app-forms.tsx`, `forms-answers-panel.tsx` | Builder and answers list |
| `apps/hub/components/form-public-view.tsx`, `apps/hub/app/f/[slug]/page.tsx` | Public page and the builder preview |
| `apps/hub/components/forms-ui.tsx` | Shared Forms styles and icons |
| `apps/hub/lib/forms/forms-client.ts` | Browser data layer: reads, durable queue, CSV |
| `apps/hub/lib/forms/public-rate-limit.ts`, `public-submission.ts` | Anonymous limits and body parsing |
| `apps/hub/app/api/forms/**` | Queue scope and the two anonymous routes |
| Rodrigo `src/actions.rs`, `src/adapters/sql.rs`, `migrations/postgresql/006_form_public_slugs.sql` | Authoritative validation, slug index, anonymous submit |

## Communications

- Member writes: `forms.form` create/update/delete and `forms.submission` update/delete through `/api/backend/actions/batch` with the Forms queue scope. Any member with the app may edit.
- Member reads: `/api/backend/resources/forms/form` and `/forms/submission`. Submissions are not filtered by form on the server; the app reads at most ten pages and says when it stopped.
- Anonymous: `GET /api/forms/public/[slug]` and `POST /api/forms/public/[slug]/submissions`, signed with the reserved public grant. Limits: 10 submissions a minute per client address, 300 a minute per form, 64 KB body, per Hub process.
- No workspace event is emitted. Hub does not learn the owning workspace of a submission.
- Rodrigo migration `006_form_public_slugs.sql` must be applied before a Rodrigo build with Forms starts.

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

# Administration console

**Path:** Hub routes `apps/hub/app/admin/**` on the admin host only (`admin.sorye.app`; locally `admin.localhost:3000`) — not a catalog app, not a Vite remote  
**Replaces:** the Operator app (catalog id `operator`, retired; listed in `RETIRED_APP_IDS` so stored selections are ignored)  
**Who:** platform administrators (`ADMIN_EMAILS`; empty in production means nobody)

## Purpose

One place for platform administration, separate from the customer Hub. Sections: Overview, Workspaces and access, Applications (settings inventory for every catalog app), AI and workers, Integrations and storage, Releases and infrastructure, Configuration history. It shows counts, names and configured flags. It does not show document bodies, prompts, OCR rows, message contents or secret values, and it does not charge a card. The full inventory is [docs/admin/SETTINGS-MATRIX.md](../admin/SETTINGS-MATRIX.md); operations are in the [runbook](../admin/ADMIN-CONSOLE-RUNBOOK.md).

## Key files

| File | Purpose |
|------|---------|
| `apps/hub/lib/admin/hosts.ts` | Host classification, admin allowlist, write-origin rule (Edge-safe) |
| `apps/hub/lib/admin/access.ts` | `adminAccess()`: admin host, real session, platform admin; write rate limit, bounded JSON |
| `apps/hub/lib/admin/audit.ts` | Intent-then-outcome audit for Hub-owned actions |
| `apps/hub/lib/admin/shared-ai.ts` | Shared AI configuration read, write, rollback and propagation view |
| `apps/hub/lib/admin/settings-inventory.ts` | Typed settings inventory (source of the matrix) |
| `apps/hub/lib/platform-config/watcher.ts` | Poll, apply, cache and report in Hub and the OCR worker |
| `apps/hub/lib/rodrigo/platform-client.ts` | Signed Rodrigo `/v2/platform/**` client |
| `apps/hub/components/admin/operator-panels.tsx` | Health, activity, usage, load, errors, plans, notices (former Operator UI) |
| `apps/hub/components/operator-notice-banner.tsx` | Notice text only, for signed-in users |
| `apps/hub/lib/operator/` | Bounded metrics, plans, notices, cached health |
| `packages/types/src/platform-config.ts` | Configuration and audit contract types |

## Communications

- `GET /api/operator`, `POST /api/operator/plan`, `GET/POST /api/operator/notices` — admin host and platform admin only. Plan and notice changes are audited in Rodrigo first; without the audit log they are refused (503)
- `GET/PUT /api/admin/console/config/shared-ai`, `POST …/rollback` — revisioned shared AI configuration in Rodrigo (expected revision, change ID, conflict 409)
- `GET /api/admin/console/audit`, `/platform`, `/workspaces/{id}` — history, integration and delivery status, one workspace's access review
- `GET /api/admin/llm`, `POST /api/admin/llm/action` (`stop` only, while paused) — this Hub process's engine telemetry and stop
- `GET/POST /api/notices` — signed-in user; `{ id, message }` when the audience and date window match; dismiss is per user
- Metrics are queued and dropped on overflow. User routes do not wait for them and do not run health probes

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

## Public app introductions

Every catalog app has a public /learn/<slug> introduction with plain-language copy owned by apps/hub/lib/app-landings.ts. Exact catalog subdomains at their root show that introduction when routed to Hub. Open links use the canonical Hub app route and its existing authentication. See [landing-page steering](../APP-LANDINGS.md).

Protocolio editor → authenticated Hub generate/validate/health endpoints → separate Protocolio renderer and its MongoDB. SDK source belongs to the Protocolio repository; Sorye consumes a versioned archive. Browser generation no longer falls back to direct engine access. See PROTOCOLIO.md for deployment and credentials.

## Independent app subdomain deployment

The deployment files in `deploy/` provide one image and Dockyard registration per catalog app. Eleven remote images contain their compiled federation assets at `/remote/`; the remaining images are gateways to Hub-native or externally embedded apps, not extracted implementations. Each gateway redirects `/` to `/apps/<slug>` and forwards authenticated pages and APIs to the single Hub. Contact remains a presentation page. Public introductions remain at `/learn/<slug>/<locale>`. Existing direct-to-Hub subdomain routing still serves introductions until ingress is switched to the app gateway.

Hub owns sessions, workspace authorization and records. Gateways have no persistent application data. Hub `.data` is mounted on a named volume; back it up before replacement. App landing descriptions were reviewed: capabilities and limitations remain accurate; deployment changes do not add product features.

## Tasks, Notes, and Calendar storage cutover

These slices call Hub, which authorizes and signs v2 operations to Rodrigo. Their old resource mutation endpoints are disabled, and queued browser mutations remain in app-owned IndexedDB until Rodrigo confirms commit or duplicate. The previous per-workspace legacy forwarding and Notes size-limit description is obsolete. Event notification writes remain Hub-owned. Catalog IDs, mounts, and federation wiring are unchanged. See the [no-migration runbook](../RODRIGO-DATABASE-SWITCHING-RUNBOOK.md).
