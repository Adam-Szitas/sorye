# Verification — 2026-11-05

- Built all eleven remote images successfully with Docker Desktop's Linux engine: dashboard, calendar, notes, tasks, relay, protocolio, canvas, devkit, messenger, ocr, studio. Builds include TypeScript checks and federation compilation at `/remote/`.
- Built the Mail gateway image and validated Nginx configuration, `/healthz`, and the relative `/apps/mail` redirect. With a deliberately unavailable Hub, the proxied route returned 502 as expected.
- Tested Tasks remoteEntry delivery: HTTP 200, JavaScript content type, CORS header, and no-cache policy. Checked the rebuilt Dashboard gateway's relative redirect and remote entry delivery.
- All twenty app Compose configurations and the Hub Compose configuration passed `docker compose config --quiet` with placeholder deployment values.
- Dockyard's nine existing tests passed, including immutable references, healthy release persistence, failed health recovery, configuration drift and authentication checks.
- `git diff --check` passed.

Clean builds exposed missing platform dependencies in Notes, Canvas and Relay; their manifests and lockfile were corrected.

Not verified: execution on the actual Forgejo runner, registry publication, Hub production image rebuild, DNS/TLS, Google callbacks on deployed subdomains, authenticated browser save/reload, and target-VM Dockyard deployment/rollback. These require the configured deployment environment. Gateway health is process health only. Hub-native UI remains shared Hub code behind separate gateways.

Workflow syntax reference: https://forgejo.org/docs/latest/user/actions/reference/

## Alignment checks ? 2026-11-10

- All 22 deployment Compose files validate, including the separately registered OCR worker; root infrastructure and Protocolio Compose also validate with placeholder configuration.
- Built the production-dependency OCR worker image and an OCR gateway image using the local Linux Docker engine.
- Started the worker against an isolated PostgreSQL queue schema and observed a fresh worker-specific filesystem heartbeat and a live database heartbeat. Pausing only the disposable database made the heartbeat stale (40.6 seconds); restoring it renewed health. The final rebuilt worker shut down with exit code 0, logged completion and marked its database heartbeat completed.
- Sent 68,108,864 bytes (64 MiB plus 1,000,000 bytes) through the real Nginx gateway to a disposable upstream: HTTP 200 with all bytes received. A 68,157,441-byte request (65 MiB plus one byte) returned HTTP 413.
- Publication mock tests cover failed builds/pushes, recovery after partial publication, verified reuse, changed build inputs, incorrect commit labels, authentication errors, connectivity errors and registry errors. They run in CI before publication.
- Hub TypeScript check and all six existing scalability tests pass, including the local PostgreSQL schema check and bounded multipart/concurrent upload admission.
- Behavior maps and deployment documentation describe the worker's queue, shared storage, heartbeat and shutdown boundaries. OCR landing copy remains accurate; no new product capability is advertised.

The Forgejo concurrency syntax was checked against its [official reference](https://forgejo.org/docs/latest/user/actions/reference/#concurrency). Actual runner publication, registry immutability policy, deployed credentials, DNS/TLS and end-to-end authenticated save/reload still require the target environment. The current contract does not make Rodrigo the owner of OCR jobs or Drive bytes.
