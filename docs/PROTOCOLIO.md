# Protocolio integration

Engine and SDK ownership: ../protocolio (SDK under packages/sdk). Editor ownership: apps/protocolio in Sorye. The former protocolio-dashboard checkout is no longer needed to install or build Sorye. vendor/protocolio-sdk-1.0.0.tgz is the built SDK artifact; pnpm-lock.yaml pins its integrity. Never edit the archive: release a new SDK version from the engine repository.

Local service: `docker compose -f compose.protocolio.yml up -d --build --wait`. This starts a separately limited PDF engine on loopback port 3100 and a private MongoDB with its own volume. PROTOCOLIO_SOURCE_DIR can override the local engine checkout. The current local image tag is sorye-protocolio:1.0.0; production must publish and pin the reviewed image digest before rollout.

Hub uses PROTOCOLIO_API_URL (default http://127.0.0.1:3100). For a containerized Hub use the service-network URL http://protocolio:8080. Configure PROTOCOLIO_SERVICE_TOKEN with a token provisioned by Protocolio's existing token system for production. Hub refuses missing production credentials and does not auto-register replacements in production. Local development can use Protocolio token registration; keep its cached .data/protocolio-bridge.json private. Existing engine quotas still apply to the token.

The editor generates and validates through authenticated Hub endpoints, with health through Hub too. It no longer falls back to direct browser generation. PDF records and workspace authorization remain Hub responsibilities; the renderer is a separate process. Existing rendering SSRF limits, service quotas and output limits must be reviewed before exposing this service beyond loopback. No production deployment or public package publication is included in this change.
