# Scalability and user-experience review

## Implementation continuation status — 2026-10-28

Implementation has started but is **not complete**. See the detailed continuation log in [SCALABILITY-PROMPTS.md](./SCALABILITY-PROMPTS.md). Current uncommitted changes include an early Postgres-backed shared-state abstraction, workspace DB failure handling, document revision checks, chat unread summary queries, paginated OCR summaries, an S3 blob interface, bounded request-body reading, and a durable OCR queue with a separate worker command and client polling.

The OCR job path now typechecks but has not been run against Postgres/GPU and is not production-ready until schema is applied and a separately supervised worker is deployed. Worker heartbeat/liveness rejection is implemented but untested in a multi-process environment. A dry-run-by-default JSON metadata importer now exists, but has not been run or validated against an inventory/backup; Drive byte migration is still missing. Canvas cross-instance delivery and the Relay outbox are missing; Tasks/Notes/Calendar now preserve 409 drafts and offer download or discard-and-reload, but concurrency behavior still needs integration checks. Production deployment and bucket settings are unverified. Do not use this document as evidence that the overall risks are resolved.

**Immediate handoff:** the Messenger `(createdAt,id)` cursor fix is implemented across Hub SQL/JSON queries, route, API client, and UI polling. Polling consumes `hasMore` with a four-page per-cycle bound, preventing timestamp ties from skipping messages while limiting work per timer tick. `pnpm exec tsc --noEmit -p apps/messenger` passes. The overall scalability work remains incomplete: see the outstanding items and validation limits below and the continuation log in [SCALABILITY-PROMPTS.md](./SCALABILITY-PROMPTS.md).

Reviewed 2026-10-28 against commit `a92faac`. Static source/configuration review, not a production benchmark or exhaustive security audit. No production metrics, deployed infrastructure inventory, database query plans, or target traffic mix were available. Severity below expresses impact and architectural exposure, not a measured failure threshold.

**Conclusion:** fix persistence, concurrency, bounded data access, and background execution before considering a backend rewrite. The source does not establish that Node.js is the limiting factor. A separate compute worker is justified for PDF processing; its language should follow profiling and correctness tests.

## Prioritized findings

### 1. Critical before multiple Hub instances: local shared state

`apps/hub/lib/store/json-file.ts` caches each file for the lifetime of the process and serializes mutations with a process-local queue. Every mutation stringifies and writes the entire file. Notifications, handoffs, Relay, Mail, Site, Storefront and Drive metadata use this helper directly, independently of `STORE_DRIVER=postgres`.

Consequences:

- Separate instances have separate authoritative caches. Separate disks diverge; sharing a filesystem does not fix stale caches or cross-process lost updates.
- Unrelated workspaces contend on the same per-feature write queue. File size and serialization cost grow with total tenants, even where each tenant has a cap.
- Drive bytes live on local disk. An instance that lacks the file cannot serve it.

Move shared records into Postgres and file bytes into object storage, with workspace authorization preserved at Hub. A persistent volume and one writer are only an interim deployment constraint, not horizontal scaling. Back up and restore-test existing local state before migration.

Evidence: `apps/hub/lib/{notifications,handoffs,relay,mail,site,storefront,files}.ts`; `apps/hub/lib/store/json-file.ts`.

### 2. High: simultaneous edits can lose accepted changes

Tasks, Notes and Calendar replace a whole workspace document. The Postgres stores read a revision, then update without checking that revision in the SQL predicate. The Tasks API does not accept an expected revision. Two editors can both receive success while one overwrites the other's changes. Concurrent first saves can also collide on the unique document key.

Canvas has an expected-revision check, but it occurs before a separate unconditional SQL update: two requests can both pass the check. This is not atomic conflict protection.

Use atomic compare-and-swap updates (`WHERE revision = expectedRevision`, increment in SQL, inspect returned row), explicit conflict responses and a draft-preserving UI. For growing documents, use item-level mutations and transactions. Consider collaborative operation merging only if simultaneous editing is a product requirement.

Evidence: `apps/hub/lib/store/workspace-docs-postgres.ts`, `workspace-docs-workspace-db.ts`, `canvas-postgres.ts`, `canvas-workspace-db.ts`; `apps/hub/app/api/tasks/route.ts`.

### 3. High: external database errors silently change the persistence destination

`withWorkspaceDb()` catches an external database operation failure and runs the default-store operation. This includes writes. During an outage users can save into the Hub database, then return to the external database after recovery and see different data. An ambiguous commit followed by fallback can create inconsistent outcomes. This also weakens the intended data-location boundary.

Fail explicitly for an unavailable configured workspace database. Preserve drafts and retry idempotently against the same owner. Replication/failover requires a designed consistency and recovery protocol, not a catch-all fallback.

The per-workspace pool map also has no eviction or URL-change invalidation. Each pool allows five connections; multiply connection budgets by active workspaces and Hub replicas. The default pool allows ten per process. Idle timeouts help, but do not establish a fleet-wide budget.

Evidence: `apps/hub/lib/workspace-db.ts`; `packages/db/src/client.ts`; workspace store facades.

### 4. High: a notification refresh reads the entire chat history

`getNotificationSnapshot()` calls `countMessengerUnread()`, which calls `bootstrapMessenger(..., { includeMessages: true })`. The Postgres implementation selects all workspace messages, including inline image data, then filters and sorts in JavaScript. Mark-read uses the same full bootstrap. Paginated chat threads therefore do not bound this common background path.

Compute unread counts in SQL against persisted per-user/channel read positions, with authorization in the query. Return counts, not message bodies. Avoid full-history reads when marking a channel read. Store images as object references.

The checked-in schema lacks a composite message index matching the channel/time/id pagination queries. Verify actual deployed indexes, then validate candidates such as `(channel_id, created_at, id)` using representative `EXPLAIN (ANALYZE, BUFFERS)` results. Also inspect workspace/channel and membership lookup indexes.

Evidence: `apps/hub/lib/notifications.ts:153`, `messenger-unread.ts`, `store/messenger-postgres.ts`, `store/messenger-list.ts`; `packages/db/src/schema.ts`.

### 5. High: OCR admission and execution do not scale across users or replicas

OCR admits one analyze/continue workflow per Hub process, with a one-second cooldown. Other requests receive 429. This protects one process, but provides no durable queue, tenant fairness or shared GPU admission across replicas. Analyze requests have a 240-second abort signal; inference batches budget 70 or 210 seconds. Long work remains tied to HTTP requests and browser continuation.

The new-upload rate counter runs before admission: retries rejected because another user is processing can consume the six-attempt/ten-minute allowance. The retry response suggests three seconds even when remaining work may take minutes.

Use a durable job record and bounded queue, idempotent submission, per-workspace fairness, shared GPU concurrency limits, progress and cancellation. Isolate PDF extraction in workers with memory/CPU/time limits. `readPdfAsRows()` has no abort parameter, so the request signal does not directly cancel its page loop. Keep existing size/page checks and source-value validation.

GPU service time remains a capacity constraint regardless of the Hub language. Measure queue wait, extraction duration, inference duration, throughput, cancellation and memory before buying capacity.

Evidence: `apps/hub/lib/ocr/{admission,analyze,read-pdf,rate-limit}.ts`; `apps/hub/app/api/ocr/analyze/route.ts` and the continue route.

### 6. High: OCR library and file paths can cause large memory spikes

The OCR list selects 20 full analysis records, including pages and patterns. Mapping also creates a flattened `lines` representation. The API returns these full records. A count limit alone is insufficient when an individual transcript may approach the 16 MB input storage cap; exact response and heap sizes require measurement.

Return paginated summaries for the library and fetch one analysis on demand. Page or stream large reading data where appropriate.

Drive reads complete files into buffers; uploads and OCR also materialize whole files and additional copies. The file cap is 64 MiB. Concurrent transfers consume substantially more than a single file's size once buffers and parsed structures coexist. Enforce request-body limits while reading, not solely after parsing or through an optional Content-Length header. Stream transfers and use authorized object-storage uploads/downloads where suitable.

Evidence: `apps/hub/lib/store/ocr-analyses-db.ts` (`selectOcrAnalyses`, `rowToAnalysis`); `apps/hub/app/api/ocr/analyses/route.ts`; `apps/hub/lib/files.ts:353`; `apps/hub/lib/security-limits.ts`.

### 7. High before multiple instances: realtime is process-local

Canvas subscribers, presence and presence authorization are in module-level Maps. A save handled by instance A cannot notify a subscriber connected to B. Sticky sessions alone do not connect collaborators on different instances.

Use a shared realtime event transport, with database revisions as the authority, reconnect resynchronization, bounded subscriber buffers and connection limits. Review other local controls, including OCR locks and rate counters, before adding replicas.

Evidence: `apps/hub/lib/canvas-realtime.ts`; Canvas events route; `apps/hub/lib/ocr/admission.ts`.

### 8. Medium/high: hidden apps continue work, and burst chat delivery has a cursor gap

The workspace keeps visited apps mounted and hides inactive panes with CSS. Messenger polls every 2.5 seconds without checking pane or page visibility. Its poll does prevent overlapping requests, but hidden panes still run it. Canvas retains its SSE subscription while mounted. Retaining editor state is useful; retaining all effects indefinitely adds memory, network and rendering work.

At 1,000 mounted Messenger clients, the nominal timer rate alone is about 400 requests/second, before other traffic, assuming requests finish within the interval. This is arithmetic, not a measured capacity estimate. Browser background throttling may change the actual rate.

Propagate pane activity, pause nonessential effects, revalidate on activation, and preserve drafts before any eviction of heavy apps. Shared notification refresh already has visibility-aware controls; extend that policy to app-specific effects. Keep background actions that users intentionally started independent of pane visibility.

Chat incremental polling uses a timestamp-only `after` cursor and ignores `hasMore`. A burst spanning a page boundary with equal timestamps can skip messages. Use `(createdAt, id)` cursors in both directions and bounded catch-up pagination. Add a same-timestamp burst regression test.

Evidence: `apps/hub/components/app-workspace.tsx:126`; `apps/messenger/src/App.tsx:284`; `apps/messenger/src/messenger-api.ts:89`; `apps/hub/lib/store/messenger-list.ts`; `apps/canvas/src/App.tsx`.

### 9. Medium/high: external delivery is on the event request path

Relay loops over matching routes and awaits webhook delivery sequentially, with an eight-second timeout per webhook. Notifications are recorded after delivery. Several slow destinations can delay event responses and badges; there is no durable webhook retry worker in this path.

Persist an outbox record and notification promptly, then deliver asynchronously with bounded concurrency, exponential backoff/jitter, idempotency keys, attempt history and a dead-letter policy. Treat externally visible delivery as at-least-once and design receivers for deduplication.

Evidence: `apps/hub/lib/relay.ts:260`, `:375`, `:437`; `apps/hub/lib/events.ts`.

### 10. High operational exposure: deployment and retention need explicit decisions

The checked-in `fly.toml` specifies one shared CPU, 512 MB RAM, scale-to-zero and no volume mount. This is not proof of the live configuration. If deployed as written, it offers limited headroom for buffered files/PDFs, cold starts, and no declared durable home for local state. Verify deployed configuration and backups immediately. Do not add replicas until local-state issues are resolved.

Data caps also affect quality: Storefront retains only the latest 100 orders and Mail 400 messages. These are retention behaviors, not merely pagination. OCR now paginates library summaries and no longer deletes older analyses at the 50-row display/query boundary; confirm that policy and provide archive/export controls before production. Heavy use can remove Storefront/Mail history users expect to retain. Define archive/export/retention policies and distinguish display limits from deletion.

Evidence: `fly.toml`; `apps/hub/lib/storefront.ts:206`; `apps/hub/lib/mail.ts:367`; `apps/hub/lib/store/ocr-analyses-db.ts` (`insertOcrAnalysis`); `packages/types/src/mail.ts`.

## Backend language decision

Keep TypeScript/Node for Hub authentication, workspace authorization and ordinary APIs for now. Most identified risks arise from shared-state design, queries, waiting on external services and oversized payloads. Rewriting the same behavior in Rust would retain those risks and add migration risk.

First extract PDF/CPU work into a bounded worker service or pool. Node worker threads are a valid initial implementation. Consider Rust for a measured CPU/memory hotspot if a representative prototype materially improves throughput, memory or tail latency while preserving PDF extraction quality. Keep the existing GPU inference service separately scaled; rewriting its HTTP caller will not speed up model inference substantially. No evidence here justifies a wholesale low-level rewrite.

Node's documentation distinguishes CPU work suitable for workers from asynchronous I/O: [worker threads](https://github.com/nodejs/node/blob/main/doc/api/worker_threads.md). Index design should follow actual query predicates and plans: [Postgres multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html). Deployment storage must be verified separately: [Fly volumes](https://fly.io/docs/volumes/overview/).

## Recommended execution order

1. Protect data: verify backups/restores and persistence mounts; eliminate silent external-DB fallback; make revision checks atomic; establish retention requirements.
2. Fix high-amplification paths: SQL unread counts/read positions, query indexes, summary-only OCR lists, bounded/streamed transfers and request-scoped reuse of authorization results. Session construction currently repeats queries and loops over workspace summaries; optimize without caching authorization across users or weakening revocation.
3. Prepare horizontal scaling: migrate remaining shared JSON stores, object storage for files, shared Canvas transport, distributed admission and rate limits, durable OCR jobs and Relay outbox.
4. Improve browser lifecycle: pause inactive app effects, bound retained heavy resources, fix chat cursors, profile long document rendering on lower-memory devices.
5. Validate capacity and only then size infrastructure or select a native compute implementation.

## Validation before claiming high-usage readiness

Use production-mode staging with synthetic data. Do not run destructive load against customer workspaces. Test growing history and concurrent users independently; a small empty database is not representative.

- Matrix: 50/200/1,000 active clients as test steps, not promised capacity; many small workspaces and one busy shared workspace; 10k/100k/1m-message datasets; varied file sizes and near-limit PDFs.
- Workflows: login/session, idle shell, Messenger polling and unread counts, simultaneous Tasks/Canvas edits, Drive transfers, OCR with unrelated interactive traffic, slow webhooks and mail providers.
- Failure tests: external DB outage and ambiguous writes; worker/Hub restart mid-job; two Hub instances with collaborators on different instances; object-store failure; duplicate submissions; backup restoration.
- Browser tests: open every app, switch panes repeatedly, leave hidden panes mounted, reconnect, and measure heap, requests, long tasks and interaction responsiveness.
- Collect p50/p95/p99 latency, errors and 429s, query count/time and pool wait, event-loop lag, RSS/heap, disk/object storage, queue age, GPU utilization/VRAM, job completion and browser performance.
- Proposed initial acceptance goals: ordinary interactive API p95 <300 ms and p99 <1 s under agreed target load; unexpected failures <0.1%; no lost acknowledged writes; no cross-workspace access; bounded memory/queues during a two-hour soak. Exclude long compute jobs from interactive latency and give them separate queue/completion SLOs. These are suggested targets, not existing measurements.

Existing strengths include server-derived workspace scope, payload/page caps, OCR overload rejection and GPU checks, paginated chat threads, visibility-aware shared refresh, source-preserving OCR validation, and Sentry/server timing hooks. Retain these protections while addressing the gaps.

The behavior maps were reviewed as context. No runtime behavior was changed, so neither map was edited. Documentation drift to resolve with implementation work: security docs still describe OCR as client-only/no PDF retention and JSON as dev-only; current source includes server OCR, Drive retention and production-used JSON modules. The map's broad visible-refresh statement does not cover Messenger's independent polling loop.
