# Implementation prompt: Sorye and Rodrigo architecture explorer

## Objective and deliverables

Build a detailed, intuitive, interactive architecture learning page for the current Sorye and Rodrigo implementation. Execute this prompt after saving it. Deliver `docs/SORYE-RODRIGO-EXPLORER.html` as a standalone, locally viewable document, plus a concise companion `docs/SORYE-RODRIGO-EXPLORER.md` explaining scope, verification and maintenance. Link the explorer from the existing app overview and architecture references. Do not publish externally or alter running services to serve documentation.

The intended reader is a product owner, operator or developer who wants to discover what connects to what, how a request travels, who owns the data, what runs locally, and which parts are still being migrated. Start with plain explanations, then expose exact routes, ownership, limits, configuration and source references on demand. Avoid an overwhelming diagram with all edges equally emphasized.

## Establish facts before implementing

Read repository contributor instructions and the applicable frontend guidance. Preserve all existing changes, including both `.env.example` edits and unrelated prompts. Inspect authoritative source in both repositories. Rodrigo remains an independent repository; do not copy its implementation into Sorye.

Use the current main checkout and runtime configuration, not stale architectural aspirations. Cross-check `docs/HUB-RODRIGO-ALIGNMENT.md`, `docs/APP-OVERVIEW.md`, both behavior-map formats, `docs/TELEMETRY.md`, Hub routes/clients/stores/workers, Rodrigo composition/adapters/metrics/contracts, Compose definitions and a sanitized inspection of running container names/ports. Do not embed credentials, keys, document contents, user identifiers or private environment values.

Record a dated evidence snapshot. An observed running container proves process presence, not end-to-end connectivity or production deployment. Label unverified production state as unknown. Distinguish:

1. Implemented current path, with prerequisites where applicable.
2. Optional provider/integration, requiring configuration.
3. Existing Hub-owned path pending migration.
4. Planned target, not wired today.
5. Observed sandbox component versus a separate local stack.

If a fact cannot be established and materially changes implementation, ask the user. Do not invent missing deployments or silently turn a planned edge into a current one.

## Required subjects

### Browser and trust boundary

- Hub-native apps versus eleven Module Federation remotes; browser bundles are not backend services.
- Hub is the session/API gateway. Apps use Hub APIs, events or handoffs; they do not call each other, Rodrigo or a database directly.
- Auth.js/dev bypass verifies the login; Rodrigo resolves the user, memberships, plan and workspace. Dev bypass does not bypass Rodrigo.
- Workspace identity is derived server-side. Hub signs method, path and body hash using Ed25519 assertions with narrow scopes; Rodrigo verifies these and can recheck membership.
- Browser IndexedDB pending actions, stable action IDs, expected revisions, receipt deduplication, acknowledgements, conflicts and explicit retry. IndexedDB and Hub caches are not authoritative database substitutes.
- Hub bounded read/session caches and Rodrigo change-stream invalidation. Distinguish database change notifications from the product event/Relay/notification system.

### Records, files and internal storage

- Rodrigo PostgreSQL owns migrated typed records, identity, receipts, object sessions/metadata, changes, quota/ledger, Site revisions and sealed storage credentials.
- S3-compatible object storage owns default binary bytes. Explain the provider JSON `storage` registrations and `objects` selection, health sentinel, checksums, resumable parts and metadata/byte split.
- Explain local RustFS: S3 API plus a Docker volume for persistence; it is not a relational database or an ephemeral Hub filesystem directory.
- Explain 8 MiB transfer parts, Drive's 64 MiB file/200-file limits, and the separate lower-level object's 2 GiB ceiling. Do not imply the object ceiling is Drive's UI allowance.
- Explain customer bucket and customer PostgreSQL file destinations, credential encryption under Rodrigo's persistent base64 32-byte key, per-workspace scope, eligibility, reservations, probes, `in_use` protection and fail-closed behavior.
- Distinguish Hub `.data` / JSON stores and optional Hub PostgreSQL for remaining domains, historical identity/files no longer read, memory caches, browser persistence, key mounts, database volumes, object volumes and model-weight volumes.
- Explain optional MySQL/MongoDB legacy document adapters and Redis as cache, not a transparent alternate owner for current PostgreSQL-only v2 families.
- Protocolio's separate MongoDB is owned by that service, not Rodrigo's document adapter.

### Compute and GPU

- Current OCR path: Hub-owned jobs/worker, source PDFs in Drive, optional configured model server. PostgreSQL mode has a durable Hub queue; JSON development can use direct requests.
- Model inference: Ollama Qwen local profile or vLLM profile, NVIDIA device assignment, model weights on persistent volumes, limits, model probe, guard memory/temperature checks where the worker can run `nvidia-smi`. Extracted rows survive unavailable optional AI.
- Browser Studio WebGPU uses the visitor's GPU and is separate from the server inference GPU.
- Protocolio rendering uses Hub's existing bridge and its separately deployed service.
- Rodrigo service-token endpoints and client exist, but do not claim current OCR/Protocolio callers use them when source shows no such call sites. Future job leases and compute coordination remain planned.
- Sandbox network isolation: the host's running GPU/renderer does not establish sandbox reachability. Do not add outbound connections or change GPU settings as part of this documentation task.

### Metrics and statistics

- Rodrigo private metrics listener, readiness versus liveness, bounded route/status/action labels, request count/duration, in-flight requests, adapter readiness and action outcomes/errors.
- Prometheus pulls the metrics endpoint; Grafana queries Prometheus. Inspect the actual target: the separate monitoring stack must not be depicted as scraping the sandbox automatically.
- Sentry browser/Hub/remote error and performance telemetry is optional and DSN-controlled, with privacy filtering. It is separate from PostgreSQL records and product statistics.
- Reports aggregates workspace app-event counts and failed Relay deliveries; its `report-stats.json` index and Hub event/Relay sources are not infrastructure Prometheus metrics. Admin-only access and no message/file contents.
- GPU snapshots/activity logs and operator/console views are not evidence of a deployed GPU exporter.
- Proposed OTel Collector/Loki/Tempo/Proxmox-wide monitoring belongs in planned state unless verified present. No live metrics, fake health lights, invented utilization, automatic polling or credential-bearing requests.

## Interactive experience

Create a polished technical atlas with restrained colors, clear typography, strong hierarchy, visible legends and useful whitespace. Use system fonts, HTML, CSS, inline SVG and plain JavaScript; no CDN, external fonts, build step or graph library. The file must work when opened using `file://` with no network.

Required interactions:

- Click any component to highlight its incoming/outgoing edges and inspect its responsibility, owned state, callers/dependencies, routes/protocol, configuration keys, persistence lifetime, failure behavior, deployment status and source references.
- Click a connection in an accessible connection list to inspect its direction, protocol, payload, trust/scoping, acknowledgement/failure behavior and endpoints. Permit jumping to either endpoint.
- Offer focused views for the core path, storage, compute, observability and all components. Clearly identify when a view includes optional/planned edges.
- Provide an implementation view and a sandbox view, with explicit notes on separate local stacks. Selecting a node outside the active view must reveal it rather than leaving a hidden selection.
- Search names, responsibilities, routes and configuration. Provide a visible result count and empty state, and a reset action.
- Guided, manually stepped journeys for sign-in, saving an app record, Drive upload, Site publish/public read, OCR/GPU analysis and metrics/statistics. Each step highlights the actual components and edge involved; include completion and failure outcomes. No automatic animation required.
- Component and connection deep links in the URL hash, browser back/forward support, and reset to a defined default. Hashes must work on `file://`.
- A detailed ownership/persistence reference table and a glossary explaining terms such as metadata, object storage, receipt, cache, assertion, change stream, scrape and GPU inference.
- A readable source/evidence section, snapshot dates, scope/known limits and a visible link to this implementation prompt.
- Print mode expands component and connection details and the long reference content. JavaScript-disabled readers must receive a useful static overview and a clear explanation of interactive requirements.

## Accessibility and reliability

Use native buttons/links/labels and semantic landmarks/headings. All actions must work with keyboard Tab/Enter/Space. Show focus indicators, pressed/current state and short live status announcements without announcing the entire inspector. Do not rely on color or mouse hover. Keep control targets at least 44 px where practical. Support reduced motion, browser zoom, narrow screens and printing. Avoid page-wide horizontal overflow; any wide graph must scroll within a labeled region with an equivalent textual connection list. Never hide focusable controls under `aria-hidden`.

Keep content data separate from rendering logic in the standalone script. Use stable node/edge IDs and shared datasets for the map, inspector, search, journeys and reference tables. Escape interpolated text; never execute content strings. Avoid timers/polling, unbounded event subscriptions or network calls. Maintain focus when rerendering controls.

## Verification and acceptance

Before completion:

1. Check every connection against source and distinguish planned/optional/current/sandbox status accurately. Fix stale blanket claims in nearby architecture documentation only where necessary to prevent contradictory guidance; preserve the existing future infrastructure design as a proposal.
2. Validate unique IDs, valid edge endpoints, valid journey steps, meaningful source references, no secret values and no external asset requirements.
3. Run a real browser check of node selection, connection inspection, search/empty/reset, views, profile changes, all guided journeys, deep-link reload and browser history. Check keyboard activation and focus, mobile layout, no JS errors, print content and offline operation.
4. Check the graph visually at desktop and mobile sizes; do not settle for disconnected boxes, overlapping labels, unreadable edge routing or controls whose selected state is unclear.
5. Verify documentation links and JavaScript syntax. Run checks proportional to this documentation-only change; a full application rebuild is unnecessary.
6. Update both behavior maps only if runtime flows change. This deliverable documents existing behavior and must not change APIs, app mounts, authorization, persistence owners or service topology. Link to the explorer for learning without reinterpreting that link as a runtime edge.
7. Report the exact local page and prompt locations, what was verified, and any remaining unknowns or verification limits. Do not claim a production deployment or a live monitoring dashboard.
