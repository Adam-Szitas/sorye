# Rodrigo memory admission plan and implementation

Goal: delay short bursts while preserving bounded memory and reliable completion. An unbounded waiting queue would worsen memory pressure, so sustained overload retains an explicit retry response.

## Plan executed

1. Inspect request concurrency, streaming lifetime, health probes and deployment memory limits.
2. Add a 32-request waiting queue, with a one-second maximum wait before body processing.
3. Sample Linux container memory every 100 ms. Pause admission at 80% of the effective budget and resume at 70%; keep existing work running.
4. Keep request permits until streaming responses finish or disconnect. Reserve two independent health-probe slots.
5. Expose memory usage, budget and paused-state metrics. Exercise wait/recovery, bounds and contract compatibility.

Implementation lives in the independent Rodrigo repository: `src/admission.rs`, `src/http.rs`, `src/main.rs`, and `src/metrics.rs`. Its deployment and contract documentation describes the operational settings.

## Runtime behavior

Hub request → bounded Rodrigo admission wait → signed authentication and domain handler → streamed response → release request slot. The waiting stage does not buffer the request body. Queue saturation or a one-second wait timeout returns existing `429 overloaded` with `Retry-After: 1`. Pending writes must retry using their original idempotency key.

The guard discovers standard Linux cgroup v2 or v1 container accounting and a finite memory limit. Optional `RODRIGO_MEMORY_LIMIT_BYTES` lowers the budget. When accounting is unavailable, a startup warning identifies that only concurrency/wait limits apply. A later sampling failure pauses new work until accounting recovers.

The checked-in Rodrigo Dockyard limit is 512 MiB: the default guard pauses around 409.6 MiB and resumes around 358.4 MiB. This does not establish that 512 MiB is sufficient for the configured workload. Existing in-flight work, background activity, retained allocations and cache can still exceed headroom; a memory guard cannot guarantee that OOM never occurs.

Health probes have separate bounded capacity; dependency failures still affect readiness. Traefik can route new work to a healthy replica, but does not start or stop containers itself. Deploy with ingress connection limits and finite request/response timeouts, particularly for slow streaming clients.

## Verification and deployment

Completed checks: Rodrigo formatting, Clippy, 104 Rust tests, and 13 Hub/Node-to-Rust contract tests passed. The 12 provider-dependent Rust tests remained ignored; this run does not validate external provider capacity.

The isolated Linux Docker pressure test passed using a 64 MiB admission budget inside a 256 MiB hard limit. Artificial memory pressure paused admission; both health endpoints remained available. A pending request resumed after pressure cleared in 411 ms and reached the expected unauthenticated `401` response. Sustained pressure returned `429` after 1,003 ms; a 48-request burst rejected 16 immediately because the 32 waiting slots were full. The container recorded zero OOM kills. Baseline admission/authentication latency across 20 requests was 1 ms median and 2 ms observed p95; these are smoke-test measurements, not database or file-transfer performance results.

Repeat from the Rodrigo repository with `docker build -t sorye/rodrigo:memory-guard-review .` followed by `node scripts/smoke-memory.cjs`. The script creates its own disposable container and public verification key, writes results under `.local/rodrigo-memory-qa`, and stops that container afterward.

Run Rodrigo formatting, Clippy, unit/HTTP tests and Sorye's Node/Rust contract tests. Before rollout, measure queue delay, p95 latency and memory under representative concurrent file transfers inside a disposable Linux container with the intended memory cap. Confirm pause/resume thresholds and absence of OOM kills, then deploy the reviewed image. No live service or sandbox configuration was changed for this implementation.
