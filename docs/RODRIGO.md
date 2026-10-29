# Rodrigo backend integration

Rodrigo is implemented in the **separate Git repository `D:\projects\rodrigo`**. Its Rust source, Docker image, monitoring stack, tests and authoritative API contract live there. This Sorye repository contains only the Next.js caller, TypeScript types and a versioned contract snapshot. Existing Hub data paths have not moved.

The current integration is `GET /api/backend/capabilities`: Hub resolves the authenticated session, signs the request, calls Rodrigo and validates the HTTP v1 response. All four planned adapters report `not_implemented`; `dataReady` is false and document routes return HTTP 503 `adapter_not_configured`. This is the explicitly requested Rust-service-only stage. No PostgreSQL, MongoDB, Redis or S3 adapter is installed or connected by Rodrigo.

## Target boundaries

Next.js owns browser sessions and resolves the authenticated user and active workspace. Rodrigo owns domain operations, database access, cache coordination and file metadata/storage operations behind a versioned HTTP contract. Database credentials stay on Rodrigo's VM. Browsers never submit database endpoints, SQL or Redis commands.

Next.js calls Rodrigo using short-lived, audience-bound signed assertions with issuer, subject, workspace, operation scope, expiry and unique request identity. Rodrigo validates these before choosing a server-configured workspace data owner. Signing keys support rotation; the private key remains with Next.js. Production service traffic uses TLS. Authorization tests must include wrong audience, expired signatures, insufficient operation scope and workspace mismatch.

## Planned adapter requirements

The HTTP API is the stable boundary. Its OpenAPI schema and shared JSON fixtures must drive compatibility tests in both TypeScript and Rust. Replacing Rodrigo must preserve status codes, payloads, revision semantics, authorization and failure behavior, rather than merely matching endpoint names.

The current service defines interfaces for documents, cache, coordination and streaming blobs. Future domain modules and durable jobs must remain behind explicit interfaces. Database adapters advertise capabilities such as atomic conditional writes, transactions, ordered pagination and durable jobs. An adapter that cannot satisfy a domain's required capabilities is rejected at startup. SQL and NoSQL stores are not presumed interchangeable for transactions or query semantics.

Deployment configuration maps named connections to service endpoints on database, Redis and storage VMs. Workspace routing uses trusted server configuration. A failed configured database never falls back to another owner. Connection pools, operation deadlines, concurrent work, request/response sizes and retry budgets are bounded per dependency.

The planned Redis adapter will own disposable cache and coordination only. Durable user records and acknowledged jobs require durable database ownership. Cache failure must have an explicit per-operation policy; authorization never depends on a stale permissive cache entry. The file interface provides a future streaming blob boundary; its S3 implementation and metadata ownership are deferred.

## Current API and future document semantics

- `GET /health/live`: process liveness without dependency details.
- `GET /health/ready`: service initialization is ready, with `dataReady: false`; this does not assert database readiness.
- `GET /v1/capabilities`: authenticated contract version and supported operations.
- `GET /v1/documents/{kind}`: authenticated stub returning 503 `adapter_not_configured`; future adapters will return a workspace document and revision.
- `PUT /v1/documents/{kind}`: validates payload and expected revision, then returns 503 `adapter_not_configured`. Future adapters must provide atomic conditional updates with HTTP 409 on conflict. Initial kinds: tasks, notes, calendar.
- Separate private metrics listener: Prometheus metrics with bounded labels.

Errors have stable machine-readable codes and request IDs. Dependency errors return 503, overload returns 429, unsupported operations return explicit capability errors. Internal connection strings and provider errors never enter client responses. Writes are not automatically retried unless their operation is idempotent or has a durable idempotency record.

## Monitoring and release evidence

Prometheus currently collects request rate/status, latency histograms, in-flight work, Linux process CPU/RSS and adapter-readiness gauges. Grafana provides a provisioned dashboard. Pool waits, dependency failures and queue age require future adapters and workers; they are not implemented metrics. Dashboards and metrics listeners stay on management networks and require authenticated access when exposed. Logs are structured and redact tokens, credentials and document bodies.

Before routing a domain through Rodrigo, prove signed-call compatibility, cross-workspace rejection, atomic stale-write conflicts, dependency outage behavior, restart recovery and equivalent saved data using an isolated database. Migration uses one authoritative writer and an explicit cutover; no silent dual writes. Load tests measure p95/p99 latency, memory and queue/pool saturation against an agreed traffic target. No language choice alone establishes capacity or security.

## Local operation and independent releases

In the Rodrigo repository, run `node scripts/setup.mjs`, then `docker compose up -d --build --wait`. API health is at `http://127.0.0.1:8088/health/ready`; Grafana is at `http://127.0.0.1:13000`. The generated Grafana administrator password is in Rodrigo's ignored `.local/rodrigo/grafana-password.txt`; username is `admin`. The backend README contains the VM/TLS deployment boundary, key rotation, monitoring limits and adapter roadmap.

Set `RODRIGO_BASE_URL`, `RODRIGO_KEY_ID` and `RODRIGO_PRIVATE_KEY_FILE` in Hub's server environment. Local development permits loopback HTTP; production requires HTTPS. Restart Hub after changing them. No domain operation switches automatically when these settings are enabled.

The authoritative schema is Rodrigo's `contracts/rodrigo.openapi.json`. `packages/types/contracts` is the reviewed Sorye snapshot. Update that snapshot and the runtime response validator together when the contract changes. A replacement backend must pass the same HTTP tests; matching a Rust interface alone is insufficient.

Build Rodrigo with `cargo build --locked` in its repository. In Sorye run `pnpm rodrigo:test` to exercise the real binary using the production TypeScript signer and fresh test keys. `RODRIGO_TEST_BINARY` selects a release artifact; the local default points to the sibling repository's debug binary. Rust tests, formatting and Clippy run independently in Rodrigo. These checks do not migrate or access user data.
