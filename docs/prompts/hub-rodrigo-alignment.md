# Prompt: align Sorye Hub (buffer) and Rodrigo (actual hub)

You are implementing the target architecture for Sorye in two repositories:

- Sorye monorepo: `D:\projects\sorye` (Next.js Hub shell + Module Federation remotes, pnpm).
- Rodrigo backend: `D:\projects\rodrigo` (Rust; authoritative HTTP contract in `contracts/`).

The product owner chose to move **every slice in this round**. Work slice by slice in the order below. Each slice must be implemented, tested, measured and committed before the next one starts. Never leave two owners for the same data.

## Read first

Sorye: root `AGENTS.md`, `docs/AGENTS.md`, `docs/HUB-RODRIGO-BOUNDARY.md`, `docs/RODRIGO-DATA-CONTRACT.md`, `docs/RODRIGO.md`, `docs/RODRIGO-DATABASE-SWITCHING-RUNBOOK.md`, `docs/APP-BEHAVIOR-TREE.md`, `docs/OWN-STORAGE.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `sandbox/LOCAL.md`.
Rodrigo: `README.md`, `docs/CONTRACTS.md`, `docs/OWNERSHIP.md`, `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/PUBLIC-API.md`, `contracts/`, `src/services.rs`, `src/http.rs`, `src/adapters/`.

## Target design (non-negotiable rules)

**Sorye Hub is a buffer and the micro-frontend host.** It keeps:
- browser login and session cookies, origin and request-forgery checks, admin-host gating;
- validation at the browser edge, app-access checks, signing of every Rodrigo call with session-derived user/workspace claims;
- edge protection: request size limits, body deadlines, upload slots, the optional throughput limit (`apps/hub/lib/upload-throttle.ts`, `bounded-upload.ts`);
- streaming large request and response bodies between the browser and Rodrigo (never buffering whole files in Hub memory);
- a short-lived **read** cache that Rodrigo change events invalidate;
- live-update fan-out to open browser tabs (notifications, Messenger presence/typing);
- the shell, Module Federation registry, Hub-native screens, public page rendering (`/learn`, `/s/{slug}`), the upload queue UI;
- calls to compute services: OCR (interactive part), Protocolio renderer, AI model streaming, previews and exports, **only with short-lived scoped tokens that Rodrigo issues per request**.

Hub must end this work with:
- **no database or object-store client** (no `@sorye/db` usage for domain data, no `@aws-sdk/client-s3`, no `pg`, no JSON domain stores under `.data` except caches that are safe to delete);
- **no stored third-party secret and no encryption key for stored secrets** (`STORAGE_SECRET_KEY`, `MAIL_SECRET_KEY` move to Rodrigo);
- **write-through only**: a write is reported successful only after Rodrigo acknowledges it. Pending writes wait in the browser's IndexedDB queue, never in Hub memory.

**Rodrigo is the actual hub.** It owns every record, credential and external integration, the durable event log, jobs, and routing of work:
- database pools (primary for writes, replicas for reads where configured), per-workspace storage target (Sorye storage or the customer's own bucket/database);
- **pull-based job queues with leases** for long work (OCR/GPU, large Protocolio renders, mail sync); workers pull, expired leases return jobs to the queue;
- endpoint selection for short service calls, per-workspace limits, queue-depth limits that answer "retry later" instead of slowing everyone;
- issuing scoped short-lived service tokens to Hub.

**Traffic load balancing is infrastructure, not Rodrigo.** Put an ingress/load balancer in front of Hub replicas and in front of Rodrigo replicas (stable/canary split, readiness-based routing). Rodrigo exposes health and readiness; it does not proxy incoming traffic for other instances.

**Rules for every slice**
- No fallback to Hub stores and no dual-writes when Rodrigo fails. Fail closed with a clear error.
- Workspace identity always comes from the server session (Hub) and is re-verified by Rodrigo from the signed assertion. Never trust a client workspace id.
- Apps never call Rodrigo or each other directly.
- Extend Rodrigo's `contracts/` first; update Sorye's reviewed snapshot and DTOs in `packages/types/` in the same slice; keep the compatibility tests green.
- Measure before and after each slice (p50/p95 latency of the affected endpoints, memory for upload paths, error rate under failure). Record numbers in the slice's commit message or `docs/` notes.
- Test failure paths: Rodrigo down, database down, storage down, stale writes, retries/idempotency, restart recovery.
- Update `docs/APP-BEHAVIOR-TREE.md` and `.html`, `docs/apps/APPS.md`, `docs/HUB-RODRIGO-BOUNDARY.md`, `docs/RODRIGO-DATA-CONTRACT.md`, the admin settings inventory (`apps/hub/lib/admin/settings-inventory.ts` + `pnpm --filter @sorye/hub docs:settings-matrix`), and landing pages whose behavior changes.

## Slices, in order

0. **Contract and plumbing.** Rodrigo capability flags per slice; service-token issuance (scoped: user, workspace, service, operation, expiry ≤ 5 min); streaming/chunked object API without the 256 KiB limit (multipart for objects up to at least 64 MB, `If-None-Match`, SHA-256 verification on write); change-event stream Hub can subscribe to for cache invalidation and live fan-out.
1. **Workspace identity.** Signed session-resolution contract: Hub verifies the login subject; Rodrigo owns users, workspaces, teams, membership, plan/subscription and enabled apps. Hub's session reads them from Rodrigo (cached with event invalidation).
2. **Storage.** Drive metadata and bytes, quota (`FileQuota`), integrity (browser SHA-256 rechecked on received and stored bytes; damaged files rejected and reported with `checksum_mismatch` / `integrity_failed`), upload ledger, customer own-storage connections and credentials (`apps/hub/lib/upload-storage/*`), Relay cloud folders (`apps/hub/lib/cloud-storage.ts`). Hub keeps the upload queue, progress UI, upload slots and throughput limit, and streams bytes to Rodrigo. Task images, Messenger attachments and OCR PDFs use this storage.
3. **Events, handoffs, Relay webhook delivery, notification storage.** Durable event log in Rodrigo with ordering, idempotency keys, retries and acknowledgements; Relay delivery with retry/backoff; notifications stored in Rodrigo and fanned out by Hub. Keep `/api/events`, `/api/handoffs`, `/api/notifications` as Hub gateway routes.
4. **Jobs.** Generic pull queue with leases in Rodrigo; OCR job records, analyses and results move there; the OCR GPU worker pulls from Rodrigo and reports to Rodrigo; Hub keeps the interactive upload and status views.
5. **Mail.** Connected IMAP/SMTP accounts and their credentials, mailbox storage, sync jobs and sending move to Rodrigo.
6. **Remaining domains.** Forms answers, Storefront status transitions, Reports statistics, billing state and payment-provider webhooks, admin audit log, Messenger attachments and read receipts.
7. **Compute services.** OCR model calls, Protocolio renderer and AI assistant model streaming are called by Hub with Rodrigo-issued tokens, or by Rodrigo workers for queued work. AI assistant tool calls go to Rodrigo.
8. **Removal and infrastructure.** Delete obsolete Hub stores, data paths, DB/S3 clients and secrets; add the ingress load balancer configuration for Hub and Rodrigo replicas to the deployment docs and the sandbox.

## Ask the product owner first (do not decide alone)

- Protocolio decision (2026-11-15): keep its editor built into Sorye's app structure; move server-side MongoDB access and document ownership behind Rodrigo; run the Protocolio Node rendering service on the app VM. Implement this in the compute and deployment slices. This is the approved target, not a completed migration. Preserve existing documents during cutover.
- Any change that makes existing sandbox or Hub data unreachable or deletes it.
- Any breaking contract change that cannot be made additive.
- Sandbox compose changes (for example adding an S3-compatible service such as MinIO for Rodrigo storage, or a second replica). `.local/sandbox/compose.json` is generated and hand-edited; propose the exact diff first.
- Anything outside these two repositories.

## Sandbox constraints

Compose project `sorye-sandbox` from `D:\projects\sorye\.local\sandbox\compose.json`, Hub on `http://localhost:23000`. Never run `down -v`, never delete volumes, never re-run `sandbox/setup.mjs`. Restart `sorye-sandbox-ingress-1` after recreating Hub if you get 502.

## Coordination

A parallel session is rebuilding the Site app into a website builder (component SDK + CMS). It owns Site/CMS code in both repositories (`packages/site-sdk`, `apps/hub/components/app-site*`, `apps/hub/app/s/**`, Rodrigo site/CMS modules). Edits to shared files (Rodrigo `contracts/`, `src/services.rs`, `src/http.rs`, `packages/types/src/index.ts`) must be additive. Publish the storage and event contracts from slices 0, 2 and 3 as soon as they are stable, and leave a note in the shared notes folder so the Site session can build media uploads and form-submission delivery on them.

## Done means

Every slice above is implemented, contract-tested and failure-tested in both repositories; Hub has no domain stores, DB/S3 clients or stored secrets; docs are updated; each repository has one commit per slice on its own branch (not pushed); the sandbox runs the new stack and the main flows (sign in, Drive upload and download, Tasks, Notes, Calendar, Messenger, OCR job, Relay delivery, Mail, Site) work in the browser.
