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
