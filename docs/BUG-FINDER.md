# Sorye bug finder

This file is the running evidence log for bugs found while testing the local Sorye sandbox. Each issue records the user journey, expected and observed behavior, environment, and the next diagnostic boundary. It does not claim a fix unless a separate change is linked.

## BUG-001 — Drive PDF opens OCR, then OCR fails during load

- **Status:** Reproduced at the API boundary; browser-side error text still needs a live bridge session.
- **Reported flow:** A user uploads a PDF to Drive while S3-backed storage is connected, clicks the uploaded PDF/open-in-OCR action, and the OCR app loads but throws an error.
- **First recorded:** 2026-11-13
- **Environment:** local sandbox ingress, `http://127.0.0.1:23000`; browser bridge tab was listed at `http://localhost:23000/apps/ocr?handoff=handoff-7867862e-f01`.

### Reproduction

1. Open Drive in the local sandbox and upload a PDF.
2. Click the PDF's **Open in OCR** action.
3. The Drive route calls `POST /api/files/:fileId/open` with `targetAppId: "ocr"`; Hub returns an OCR handoff and redirects to `/apps/ocr?handoff=<id>`.
4. OCR reads the handoff, then calls `GET /api/ocr/active` while mounting/resuming its page.

### Expected behavior

The PDF should remain available from Drive, the OCR handoff should resolve, and OCR should either begin scanning the PDF or display a recoverable progress/empty state. A transient resume-job lookup must not prevent the app from loading.

### Observed evidence

- Sandbox services are running; `objects` (the S3-compatible RustFS service) and `rodrigo` report `healthy` in `docker compose -f .local/sandbox/compose.json ps`. The local `objects` service has been up for this sandbox session.
- `GET /api/files` returned a PDF record with `mime: application/pdf`, `storedIn: sorye`, and a Drive object path under `files/ws-personal-b4cb4079/...`.
- The PDF download succeeded: `GET /api/files/e326872a-d4c0-4645-91cc-473974bb1de0` returned `200`, `Content-Type: application/pdf`, `Content-Length: 21143`, and `Content-Disposition: attachment; filename="protocol-sample.pdf"`.
- The Drive-to-OCR handoff succeeded: `POST /api/files/e326872a-d4c0-4645-91cc-473974bb1de0/open` returned `200` with `targetAppId: ocr`, `kind: workspace-file`, and `href: /apps/ocr?handoff=handoff-b778eef0-e40`.
- The handoff lookup succeeded: `GET /api/handoffs?id=handoff-b778eef0-e40` returned `200` and the expected file ID.
- The OCR resume endpoint failed: `GET /api/ocr/active` returned `500` with an empty response body. This is the first confirmed failing request in the reported path.
- `GET /api/backend/capabilities` returned `200` with `service: rodrigo` and `dataReady: true`, so the general Hub-to-Rodrigo capability check is healthy.
- The browser bridge can list the OCR tab and sees DevTools attached, but DOM/fault inspection currently returns `Could not establish connection. Receiving end does not exist.` Therefore no browser-console stack or rendered error text is asserted here.

### Current boundary / hypothesis

The Drive upload, S3-backed object read, workspace authorization, and file-to-OCR handoff all succeed. The failure is after OCR mount, at Hub's `GET /api/ocr/active` resume-job lookup (`apps/hub/app/api/ocr/active/route.ts` → `latestRelevantOcrJob`). Investigate the Hub jobs database/query and capture the server exception before changing OCR or storage code. The evidence does **not** currently indicate an S3 connectivity failure.

### Follow-up evidence to collect

- Reconnect the browser bridge receiver on port 23000 and capture the OCR tab's console/faults and HAR for the same handoff.
- Capture the Hub server stack trace for `GET /api/ocr/active` and check the jobs table/schema/connection used by `latestRelevantOcrJob`.
- Repeat with a newly uploaded PDF and record whether the failure occurs before or after `GET /api/files/:fileId` and the client-side scan starts.

## BUG-002 — Drive storage navigation, folders, and upload limits are too limited

Implementation update (2026-11-14): Folder creation, folder-picker upload, bounded recursive directory drop, breadcrumbs and general download-only file support now span Drive → Hub → signed Rodrigo APIs → PostgreSQL/object storage. Migration 014 keeps existing files at root. Workspace folders survive restart; concurrent duplicate creates converge. Relay cloud paths use create-only hidden markers and multipart prefixes now precede file bytes. The workspace queue no longer discards files beyond the speed-based batch limit. Compact progress is preserved. Executable extensions and recognized executable signatures are blocked at Hub; archives are accepted without inspecting their contents. See [Drive folders](DRIVE-FOLDERS.md).

Verification: Hub typecheck; Rust formatting, strict Clippy and tests; 15 policy/signed contract checks; live PostgreSQL/S3 integration tests for concurrent folder creation, traversal rejection, cross-workspace denial, restart persistence, nested uploads/download hashes, own S3/database targets and storage outage failure. The 64 MiB streaming test measured 21.4 MiB/s in the disposable local stack (not a production benchmark). Browser bridge on port 23000 confirmed folder creation, 12/12 files uploaded through the directory input, nested navigation and a renamed MZ executable rejected. The sandbox PostgreSQL migration is applied. External AWS/R2 credentials were not available for live cloud-marker acceptance; that path is implemented but not certified against a real external bucket. Administrator-managed upload limits remain separate outstanding work; no quota bypass was added.

- **Status:** Folder and general-file workflows implemented and verified on Workspace Drive; admin limit controls and live external-cloud acceptance remain outstanding.
- **Reported behavior:** In Drive, a user cannot reliably switch between Sorye's default storage and multiple user-added storage connections. The user also cannot create folders or upload freely enough for the intended Drive workflow. Upload ceilings and restrictions should be securely adjustable from `admin.sorye`.
- **First recorded:** 2026-11-13
- **Environment:** local sandbox ingress, `http://127.0.0.1:23000`.

### Reproduction / checks

1. Open Drive and inspect the root view.
2. Try to switch between the built-in Sorye storage and connected user storage providers.
3. Try to create a folder in either storage view.
4. Try uploads beyond the currently displayed file-size, file-count, batch, or concurrency limits.
5. Check whether an administrator can change those limits from `admin.sorye` without editing deployment code or environment files.

### Expected behavior

Drive should present the default Sorye/S3-compatible storage and every authorized user-added storage as explicit, reliable destinations. Users should be able to create and navigate folders in each destination, upload supported files subject to clearly displayed policy, and receive actionable errors. Platform/workspace administrators should be able to change safe upload policies through the authenticated, audited admin console with server-side validation and scope controls.

### Observed evidence

- `GET /api/relay/storages` currently returns `200` with `{"storages":[],"canManage":true,"available":true}`. The API can represent connected storages, but this sandbox has no user-added storage configured to verify multi-storage switching.
- The Drive component has separate React state for `cloudStorageId` and the built-in Drive view. It renders connected storage cards only when `/api/relay/storages` returns them; there is no persistent, top-level storage selector covering the default storage plus all connections.
- The current Drive root renders app-based “folders” derived from `APP_CATALOG`/`sourceAppId`, not user-created filesystem folders. The cloud object view supports prefixes, but the UI has no create-folder action.
- The upload UI accepts files through a single file picker/drop zone and the cloud-object endpoint, but no folder-creation workflow is exposed.
- `GET /api/files/quota` returns the current policy: `maxFileBytes: 67108864` (64 MiB), `maxFiles: 200`, `maxBatchFiles: 25`, `maxConcurrentUploads: 2`, and `target: "sorye"`.
- The current admin settings inventory records `files.uploadBatch` (25 files) as a release constant and upload throughput/concurrency values as deployment environment settings. These are not adjustable as audited, scoped controls from `admin.sorye`.
- The Drive landing copy also advertises “Upload files up to 64 MB each,” confirming that the per-file limit is currently a fixed product/deployment value rather than an administrator-managed policy.

### Scope / security requirements

The fix must preserve workspace isolation and server-side enforcement. Admin changes should be authenticated on the exact admin origin, authorized by platform/workspace role, validated against safe minimum/maximum bounds, audited, and applied consistently to both built-in Sorye storage and user-added providers. Credentials for added S3/R2 connections must remain encrypted/write-only; changing an upload limit must never expose them.

### Follow-up evidence to collect

- Configure two test storage connections and record whether switching, upload, download, prefix navigation, and return-to-default-storage work without stale state.
- Confirm whether folder creation is intended for Sorye storage, external S3/R2 prefixes, or both; then add contract/UI tests for the selected semantics.
- Define the policy dimensions administrators may change (per-file bytes, workspace bytes, file count, batch size, concurrency, and throughput) and their safe bounds/audit events before implementation.

## BUG-003 — Relay setup is difficult to understand and uses a narrow, left-weighted layout

- **Status:** Reported; layout constraint and setup complexity are visible in the current Relay implementation.
- **Reported behavior:** Relay is not user-friendly when setting up a database and other services. The page feels aligned to the left instead of using the available website width, making configuration areas harder to scan and compare.
- **First recorded:** 2026-11-13

### Reproduction

1. Open the Relay app and enter **Configure** or **Storage**.
2. Try to connect an S3/R2 storage or configure the other Relay services without prior knowledge of Hub, App events, routes, channels, and provider credentials.
3. Resize the page to a wide desktop viewport and compare the content width and visual balance.

### Expected behavior

Relay should guide a user through setup in a clear sequence: prerequisites, provider/service selection, credentials, connection test, destination/routing, and verification. The content should use the available app width (with sensible gutters and readable max-widths inside individual forms), rather than leaving a large unused area and visually pinning the configuration to the left.

### Observed evidence

- The Relay shell is a single `.relay-app` flex column with fixed `padding: 1.5rem`; its configuration is a vertical `.relay-config` stack of full-row panels rather than a responsive workspace that uses the available width for related setup steps.
- Storage setup is embedded as another panel and exposes provider, bucket, region, endpoint, and encrypted credential fields in one form. The page gives limited task-oriented guidance for choosing between database/own-storage and external S3/R2 setup.
- The UI explicitly requires deployment-level preparation in the user flow: when unavailable it tells users to ask a deployment administrator to add `STORAGE_SECRET_KEY` to the host secret manager. This is a technical prerequisite without an integrated setup checklist or admin handoff.
- Relay configuration also depends on separately enabling Dashboard **App events**, then configuring sources, channels, and routes. The current page presents these as panels/tabs rather than a guided setup flow with clear completion state.
- Existing styling has responsive behavior only for a narrow route row breakpoint (`max-width: 700px`); there is no wide-screen layout rule that distributes setup panels across the available viewport.

### UX / layout requirements

Use the full available app width while retaining readable line lengths inside prose and forms. Group setup into clear sections or steps, show prerequisites before credential fields, make connection/test states explicit, and keep sensitive values write-only. Preserve keyboard access, mobile collapse behavior, workspace authorization, and the existing Hub-mediated contracts.

### Follow-up evidence to collect

- Capture wide and narrow viewport screenshots of Configure and Storage to establish the current whitespace/alignment baseline.
- Test first-time setup with a non-technical workspace owner and record where they get blocked (secret prerequisite, provider fields, App events, route/channel mapping, or save/test feedback).
- Define the desired full-width information architecture before changing CSS so the page becomes easier to use without simply stretching every form field.

## BUG-004 — Site sub-app leaves unused space and lacks an in-context visual builder

- **Status:** Reported; the narrow layout and editor model are confirmed in the current implementation.
- **Reported behavior:** The Site sub-app leaves unnecessary free space instead of making useful use of the available app width. At least one tab should show a visually built-out page, not only configuration controls. The authoring experience should follow modern CMS/page-builder patterns so a user can dynamically assemble and maintain their own page.
- **First recorded:** 2026-11-13

### Reproduction

1. Open the Site sub-app.
2. Visit the Pages tab and inspect the page editor at a wide desktop viewport.
3. Add or edit sections, then use **Preview** to open the separate preview route.
4. Compare the editor with a visual builder where the page is rendered beside the controls and changes can be understood before leaving the tab.

### Expected behavior

The Site app should use the available width with a deliberate responsive editor layout. A visual-builder tab or split view should render the current page (header, hero, content, forms, media, theme, and footer) while the user edits it, with obvious selection, reorder, responsive preview, save/draft state, and publish state. The page model should remain CMS-driven: users choose supported components, edit localized content/media/settings, preview safely, and publish through the existing server-owned contracts.

### Observed evidence

- The Site CMS root wraps all content in `mx-auto w-full max-w-5xl`, which caps the editor at 5xl even when the app viewport is substantially wider and leaves unused horizontal space.
- The Pages tab is a form/list editor: it shows page metadata and an ordered list of section names with Edit, Move up/down, Remove, and Add controls. The actual page is not rendered in the tab; Preview opens `/api/site/preview/...` in a separate browser target.
- The current component model is already a useful CMS foundation (`COMPONENTS`, `componentDefaults`, `SiteSection`, localized fields, media, collections, forms, settings, validation, drafts, preview, and publish). The gap is the visual authoring surface and clearer user flow, not permission to bypass the CMS model.
- Site tabs are Pages, Collections, Media, Forms, Settings, and Publish. None is currently a dedicated visual canvas/preview workspace that keeps the rendered page visible while editing.
- **Additional confirmed failure:** With the local draft site initialized, opening the Pages tab's **Preview** link (`/api/site/preview/en`) returns HTTP `503` with `The preview cannot be loaded right now.` The preview route catches the underlying exception and exposes no diagnostic detail, so the server-side cause still needs to be captured from Hub logs.

### CMS / security requirements

Keep Hub as the authorization and persistence owner. Do not let browser-authored markup become executable HTML or bypass schema validation. The visual builder should serialize only validated component types and props, preserve locale and workspace boundaries, keep draft/publish revisions explicit, and sanitize/validate links, media references, forms, and theme overrides server-side. Preview must not publish or expose unpublished content to anonymous readers.

### Follow-up evidence to collect

- Capture wide/medium/mobile screenshots of the Site editor and quantify the unused width caused by the 5xl cap.
- Prototype the visual-builder tab against the existing `SiteSection` model and component renderer before changing the storage contract.
- Test draft edits, reload/conflict handling, preview, publish, localization, media references, and anonymous published rendering as one end-to-end CMS journey.
- Capture the Hub exception behind the `503` and add a regression test that renders the saved draft preview successfully before implementing the visual builder.

## BUG-005 — AI-MCP needs a trustworthy product name and scoped administrator controls

- **Status:** Product/administration gap identified.
- **Reported behavior:** The Hub assistant is exposed as “AI · MCP” / “Sorye MCP Assistant,” which sounds like an implementation detail rather than a trustworthy user-facing chat product. The requested user-facing name is **S-chat**. Administrators also need to disable the feature for selected projects/companies instead of only controlling the shared engine globally.
- **First recorded:** 2026-11-14

### Current behavior

- The Hub top bar button is labeled `AI · MCP` and the overlay heading is `Sorye MCP Assistant`.
- The overlay exposes permission-scoped MCP tools and workspace context, but the product name shown to users is tied to the protocol/implementation terminology.
- `admin.sorye` currently has a shared AI console with platform-wide pause/resume and stop controls. The settings inventory describes `shared-ai` as platform-scoped; no project/company allowlist or denylist control is exposed for the chat feature.

### Expected behavior

Use **S-chat** consistently in the navbar, panel title, accessible labels, onboarding/help copy, notifications, and documentation. Keep MCP as an internal technical term where it helps administrators or developers understand tool routing, not as the primary customer-facing brand.

The administration console should provide an audited, server-enforced policy for enabling/disabling S-chat per selected company/project/workspace. The policy must apply before requests and tool discovery, show effective state and propagation, fail closed when the policy store is unavailable, and never rely on hiding the button alone. Existing workspace authorization, tool permission gates, confirmation requirements, prompt/privacy protections, and shared-engine pause controls must remain separate and intact.

### Follow-up evidence to collect

- Inventory every customer-visible “AI · MCP”, “MCP Assistant”, and related string, including accessible labels and translated/static help copy.
- Define the scope terminology precisely (company, project, workspace) and the precedence between platform pause, company policy, workspace policy, and user/tool permissions.
- Add admin audit and regression tests proving a disabled company cannot discover or invoke S-chat tools, including direct API attempts and a policy-store outage.

## BUG-006 — Canvas pointer interactions are too eager and need a Miro-inspired interaction model

- **Status:** Reported; current pointer handling confirms that clicks are action-oriented with limited separation between selection, placement, editing, and navigation.
- **Reported behavior:** In Canvas, clicking left/right appears to execute actions immediately. The interaction model is not predictable enough for a spatial board and should be inspired by mature tools such as Miro.
- **First recorded:** 2026-11-14

### Current behavior

- The board handles all pointer gestures from a single surface. Left pointer down in a placement tool immediately creates an item; in Select it selects/moves an item; on an empty board it starts panning and clears selection on release.
- Sticky/text editing is entered by a timing-sensitive double tap/click window (under 400 ms) after a move-mode pointer gesture.
- Middle-button or Pan mode starts panning. Right-button down is ignored by the handler, but there is no Canvas-owned context menu or explicit right-click interaction contract.
- Toolbar tools remain active for repeated placement, so a user can continue creating objects when they intended to return to selection/navigation.

### Expected behavior

Adopt a familiar whiteboard interaction model: a clearly selected default/selection tool, explicit pan/hand mode, deliberate click-versus-drag thresholds, predictable double-click editing, right-click context actions, modifier-key behavior, undo/redo, and visible cursor/tool state. Creating an object should require an intentional tool selection or drag gesture; navigation and selection should not unexpectedly create, move, edit, or delete content.

### Follow-up evidence to collect

- Record a left-click, right-click, middle-click, double-click, click-drag, touch, and modifier-key matrix for empty space and each item type.
- Compare the matrix with Miro conventions and document the chosen Sorye contract before changing event handling.
- Add browser interaction tests covering accidental placement, context-menu actions, pan/zoom, selection, text editing, keyboard shortcuts, undo/redo, and persistence after each gesture.

## BUG-007 — Tasks does not load in the Hub browser route

- **Status:** Reproduced with the browser bridge; backend endpoint itself responds successfully.
- **Reported behavior:** Opening Tasks at `http://localhost:23000/apps/tasks` leaves the app unloaded.
- **First recorded:** 2026-11-14

### Browser-bridge evidence

- Browser bridge tab `1940153008` is on `http://localhost:23000/apps/tasks` with DevTools attached.
- The bridge HAR shows the Tasks remote JavaScript loading from `http://127.0.0.1:23102`, followed by `GET http://127.0.0.1:23000/api/tasks/scope` with status `0` and `net::ERR_FAILED`.
- The preflight for that request returns `204`, so the failure is on the cross-origin actual request/response path rather than the remote asset itself.
- Browser bridge DOM/fault inspection currently reports `Could not establish connection. Receiving end does not exist`, but the HAR contains the failed request and the remote stack path (`request` → `readScope` → `loadBoard`).

### Control checks

- From the local host, both `GET http://localhost:23000/api/tasks/scope` and `GET http://127.0.0.1:23000/api/tasks/scope` return `200` with a valid queue scope and workspace.
- `GET /api/tasks` also returns `200` with the board payload. This indicates that the immediate failure is not an unavailable Tasks API or missing board data.

### Current boundary / hypothesis

The embedded Tasks bundle is configured with an absolute Hub origin of `127.0.0.1:23000` while the browser page origin is `localhost:23000`. The browser therefore treats the API call as cross-origin; the ingress preflight succeeds but the actual response is rejected/does not complete in the browser. Normalize embedded remote API calls to the current Hub origin (or configure a same-origin proxy and explicit, tested CORS policy) and verify reload, direct app navigation, and standalone Vite-port operation separately.

### Follow-up evidence to collect

- Capture the actual response headers in a bridge session with a functioning receiver, especially `Access-Control-Allow-Origin` and credentials handling.
- Add a regression smoke test that mounts Tasks from `localhost:23000`, asserts `/api/tasks/scope` is same-origin, and waits for the board to render.
- Verify the fix does not break standalone Tasks development on its Vite port, where `VITE_HUB_ORIGIN` is intentionally needed.

### Related Messenger confirmation

The same remote-origin defect also prevents Messenger from loading in the current browser session. The bridge HAR for `http://localhost:23000/apps/messenger` shows the Messenger remote loading from `127.0.0.1:23105`, then `GET http://127.0.0.1:23000/api/messenger` and `/api/messenger/scope` failing with `net::ERR_FAILED` after successful `204` preflights. Both endpoints return `200` when requested directly through either host name. This is therefore a shared remote Vite/Hub-origin configuration defect, not a missing Rodrigo base URL or unavailable Messenger backend.

## BUG-008 — Backend outages need a clear, consistent recovery state

- **Status:** UX gap identified across backend-dependent apps.
- **Reported behavior:** When the backend is unavailable, the UI does not consistently present a clear, polished explanation. Users can see a blank/loading/error state or technical wording instead of a reassuring message that explains what is unavailable and what will happen to their work.
- **First recorded:** 2026-11-14

### Current evidence

- Canvas has multiple raw states such as `Could not load Canvas`, `Hub or Rodrigo is unreachable`, and queued-action counts; the presentation differs between initial load and an in-app action failure.
- Tasks translates some network failures, but a failed initial board load and a failed save/reconciliation use different paths and can leave the user without a single recovery-oriented status surface.
- Relay can fall back to a locally held configuration with `Using local Relay config — Hub API unavailable`, but that state does not establish whether changes are safely persisted or when the connection will be retried.
- Other Hub-native panels use their own loading/error copy and retry behavior, so there is no shared backend-outage component or consistent severity/wording model.

### Expected behavior

When Hub, Rodrigo, a worker, or a required provider is unavailable, show a visually consistent, accessible outage state that says:

- what feature is temporarily unavailable;
- whether existing data is still readable;
- whether edits are safely queued locally, not saved, or at risk;
- the last successful sync/connection state where available;
- a clear **Retry / Reconnect** action and a non-destructive next step.

The state should be calm and understandable, not a raw exception or an unexplained spinner. It must preserve queued work, distinguish offline from authorization and validation errors, announce changes to assistive technology, and avoid claiming that data is saved until the server confirms it.

### Follow-up evidence to collect

- Run a shared outage test matrix by stopping Hub, Rodrigo, PostgreSQL, and the OCR worker independently, then open Tasks, Canvas, Drive, Relay, OCR, and Site.
- Record each initial-load, read, write, queue, retry, and reconnect state and converge on one reusable status component/message contract.
- Add automated browser tests for offline/reconnect transitions, queued edits, duplicate retries, stale data labeling, and keyboard/screen-reader announcements.

## BUG-009 — OCR errors are too generic and are not reported as measurable failures

- **Status:** Reported; generic error fallbacks and incomplete failure telemetry are visible in the current OCR flow.
- **Reported behavior:** OCR displays messages such as `OCR failed`, `Analysis failed`, `Could not open file`, or `Could not store the analysis` without enough context for the user to understand what happened or what action to take. Failures also need to be reported to the measuring/observability systems.
- **First recorded:** 2026-11-14

### Current evidence

- `apps/ocr/src/App.tsx` falls back to generic messages in `runScan`, handoff loading, analysis polling, comparison, export, and send-to-Protocolio paths.
- The Hub OCR routes return some useful validation messages (PDF type/size/page limits, worker busy, file read/store failures), but the client does not consistently classify them into user-actionable categories.
- OCR emits success-style workspace events such as `sorye.ocr.analyzed`; there is no equivalent structured OCR failure event carrying a safe error code, stage, retryability, and correlation/request ID.
- Existing analytics types focus on completed OCR jobs and duration/count measurements. They do not provide a failure/error section suitable for measuring failure rates by stage or dependency.

### Expected behavior

Show a concise user-facing explanation based on a stable error code, for example: invalid PDF, file unavailable, storage unavailable, worker unavailable/busy, GPU/WebGPU unavailable, model/provider failure, analysis timeout, permission failure, or temporary network failure. Include the next safe action (retry, choose another PDF, reconnect, switch execution target, or contact an administrator) and preserve any queued/resumable work.

At the same time, report a structured, privacy-safe failure signal to the measuring systems. It should include app/version, stage, error code, HTTP status, retryability, execution target, workspace-scoped correlation ID, page/job/analysis identifiers where available, and timing. It must exclude PDF bytes, transcript text, prompts, secrets, credentials, and personally identifying content. The event should be visible to operations/administrators with bounded aggregation and deduplication so one failing document cannot flood telemetry.

### Follow-up evidence to collect

- Build an OCR failure-stage matrix from upload through PDF preparation, worker/model execution, persistence, rendering, and downstream handoff.
- Define stable error codes and localized user copy separately from internal diagnostic details.
- Add tests asserting that every failure path renders an actionable message and emits exactly one redacted failure metric/event with a correlation ID.

## BUG-010 — Reports and other administration surfaces should live only under `admin.sorye`

- **Status:** Architecture/access-surface gap identified.
- **Reported behavior:** Reports and other administration-related functionality should not be presented inside the customer/workspace Hub. They should be available only through the dedicated `admin.sorye` application/host.
- **First recorded:** 2026-11-14

### Current evidence

- Reports is still a Hub-native catalog entry at `/apps/reports` and is marked `alwaysAvailable: true` plus `adminOnly: true`. Platform admins can therefore open it in the customer Hub shell, even though regular members are filtered out.
- The Reports component is mounted by `HubNativeAppBody` and its data route is `/api/reports`; the API checks platform-admin status, but the customer-facing route remains part of the workspace app surface.
- The customer top bar exposes an `Admin` badge and, in development, a `Dev` link. Other admin-oriented entry points and operational concepts are mixed into the customer shell rather than being isolated behind the admin host.
- The dedicated admin console already has host/session guards and sections for overview, workspaces, applications, AI/workers, integrations/storage, releases/infrastructure, and history. Reports and operational analytics should be moved or linked there instead of remaining in the customer catalog.

### Expected behavior

Only the exact configured admin origin (`admin.sorye` in production) should serve Reports and administration surfaces. Customer/app origins should either return a clear not-available/redirect response or show a neutral link to the admin console without leaking operational data. Every admin page and API must continue to repeat host, session, and administrator checks; hiding a tile is not sufficient.

The admin console should own the navigation, labeling, audit context, and authorization for reports, operational analytics, platform configuration, worker status, integrations, and other administrator-only controls. Workspace members and ordinary platform users should not see admin badges, admin links, or admin-only app catalog entries in the customer shell.

### Follow-up evidence to collect

- Inventory all `adminOnly`, `isAdmin`, `/api/operator`, `/api/admin`, Reports, Dev, and operational links rendered on customer origins.
- Decide whether Reports becomes an `/admin/reports` page or a section of the admin overview, then add host-isolation tests for both browser routes and APIs.
- Test direct navigation, stale links, launcher state, standalone app routes, and cross-origin redirects for admin and non-admin sessions.

## Root-cause audit and Rodrigo dependency map

The first pass through the ten issues gives this ownership classification. “Rodrigo-dependent” means the feature uses Rodrigo but the reported defect is not automatically fixed by starting Rodrigo; “Rodrigo-missing” means the evidence points to the backend not being present or ready.

| Issue | Primary reason in the current app | Rodrigo-missing? |
|---|---|---|
| BUG-001 OCR after Drive open | Hub's OCR resume route calls the Hub Postgres jobs client while the sandbox Hub runs `STORE_DRIVER=json` and has no `DATABASE_URL`; the handoff and file/object path succeed. | No — Sorye Hub jobs configuration/ownership mismatch. |
| BUG-002 Drive storage/folders/limits | Drive UI has app-source groupings, cloud prefixes, and fixed upload constants; it lacks a unified destination/folder model and admin policy editor. Rodrigo owns Drive metadata/cloud storage after alignment, but the missing UX/policy is in Sorye contracts/UI. | No. |
| BUG-003 Relay setup/layout | Relay information architecture and CSS are narrow/technical; provider setup may call Rodrigo, but the usability/layout issue is Sorye UI. | No. |
| BUG-004 Site builder/preview | The CMS editor is a narrow form/list without an in-context canvas. Draft preview returns 503; the underlying path is Hub's preview renderer over Rodrigo-owned drafts and needs a server exception captured. | Not proven as missing Rodrigo; Rodrigo resources are readable, while preview/render or stored draft data may be failing. |
| BUG-005 S-chat naming/policy | Customer strings use MCP terminology and admin controls are platform-wide shared-AI controls; per-company/project policy is absent. | No — Sorye product/admin policy gap, with Rodrigo platform config as a possible persistence owner. |
| BUG-006 Canvas interactions | Pointer semantics/tool state are implemented in the Canvas remote; this is an interaction-model defect. | No. |
| BUG-007 Tasks load | Tasks remote uses `127.0.0.1:23000` while the page is `localhost:23000`; browser request fails cross-origin even though the API and Rodrigo board data respond. | No — remote origin/CORS configuration. |
| BUG-008 outage messaging | Apps have inconsistent loading/error/queue states and no shared recovery component. | No; backend outages are the trigger, not the root UI defect. |
| BUG-009 OCR diagnostics/telemetry | OCR client/API uses generic fallbacks and emits success events but no structured redacted failure metric. | No; telemetry/error taxonomy is Sorye-owned, with worker/Rodrigo dependencies included as dimensions. |
| BUG-010 admin-only surfaces | Reports is still cataloged/mounted under customer Hub for admins; host isolation is incomplete. | No — Sorye routing and admin-surface architecture. |

### Sandbox verification plan executed

1. Bring the complete Sorye sandbox up with `docker compose -f .local/sandbox/compose.json up -d`.
2. Rebuild Rodrigo from `D:\projects\rodrigo` and recreate the sandbox Rodrigo container so the running image matches source.
3. Verify the **sandbox** Rodrigo process from inside `sorye-sandbox-rodrigo-1` (the host's `127.0.0.1:8088` belongs to a separate monitoring stack): `/health/live`, `/health/ready`, and action readiness.
4. Verify PostgreSQL readiness and inspect the initialized Rodrigo schema.
5. Verify Sorye's signed Hub-to-Rodrigo capability proxy and representative Tasks/Drive endpoints.

### Execution result (2026-11-14)

- All Sorye sandbox services are running; `objects`, `postgres`, and `rodrigo` report healthy in Compose.
- Rodrigo was rebuilt and recreated successfully.
- Inside the sandbox Rodrigo container: `/health/live` returns `{"status":"alive"}` and `/health/ready` returns `{"status":"ready","dataReady":true,"actionReady":true}`.
- PostgreSQL `pg_isready` returns “accepting connections”; the `sandbox` database contains 24 Rodrigo tables, including actions, documents, identity, files, objects, storage, site, platform config/audit, and changes.
- Sorye `GET /api/backend/capabilities` returns HTTP 200 with Rodrigo `dataReady:true`, PostgreSQL and S3 adapters ready, and the v2 action families.
- Representative `GET /api/tasks/scope` and `GET /api/tasks` return HTTP 200.

The earlier host-level `http://127.0.0.1:8088/health/ready` result (`dataReady:false`) was from the separate `sorye-rodrigo` monitoring stack, not the sandbox Rodrigo process. The sandbox process is ready; no Rodrigo-missing condition is present in this verification.

