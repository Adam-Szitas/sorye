# App images and Dockyard

## How the services fit together

Forgejo Actions builds immutable container images and pushes them to the Forgejo registry. Dockyard promotes a chosen image digest to a VM's Docker Engine over SSH. The CI runner builds and publishes; it does not host production containers or deploy automatically.

```text
Forgejo source
    │ dispatch build
    ▼
CI runner ── build/push ──> Forgejo container registry
                                  │ immutable digest
                                  ▼
                         Dockyard over SSH
                                  │ pull + replace
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
         App VM Docker                            Data VM Docker
         Hub + gateways                           PostgreSQL / services
              │                                       ▲
              └──────── private network ──────────────┘
```

Hub is the browser-facing entry point and owns sessions, workspace access and the current Hub-backed data paths. Federation remotes are built and deployed as separate images; Hub loads them from their configured HTTPS `remoteEntry.js` URLs. App gateways provide per-app hostnames and forward requests to Hub. Apps share behavior through Hub APIs, platform events and handoffs rather than calling each other directly. Rodrigo is a separate backend release; Hub's versioned service contract is the boundary for backend operations as that integration is completed.

PostgreSQL and other stateful services can run on a separate VM. Hub and workers connect over the private network. Give databases persistent volumes and independent backups; deploy database schema changes explicitly. Dockyard deploys a registered Compose service and its image; it does not provision VMs, networks, DNS/TLS, databases, credentials or migrations. Keep stateful services in separate registrations from stateless app images so app promotion and rollback do not restart or replace databases.

For each release, review the action's image digest, then promote that digest to the intended registration with `dockyard ship <ssh-alias> <app> <registry/image@sha256:digest>` (or run `dockyard deploy <app> <registry/image@sha256:digest>` on the target). Each registration is an independent release unit. Check service health and application behavior after promotion; image rollback does not roll back database data.

**Hub is the app-facing gateway, not the intended domain backend.** The target is apps <-> Hub <-> Rodrigo. Existing Hub data/event code remains pending migration. This workflow does not build Rodrigo; release it separately and record compatible Hub/Rodrigo digests and contract versions. See [ownership, current gaps and release ordering](../docs/HUB-RODRIGO-BOUNDARY.md).

Run the Forgejo publish workflow with the existing registry credentials and remote URL variables. Set each `NEXT_PUBLIC_<APP>_REMOTE` to `https://<slug>.sorye.app/remote/remoteEntry.js`. These are Hub build inputs. The workflow publishes Hub, twenty app images, the `-admin` gateway image and a separate `-worker` image and prints their registry digests. A retry reuses images only when their commit and build-input labels match; changed inputs or registry errors stop publication. Per-commit workflow concurrency prevents overlapping runs; enforce immutable SHA tags in the registry as an additional guard. Older images without these labels require a new commit rather than an overwrite. Use the printed digest, never a mutable tag, for promotion. The build runner architecture must match the target VM.

Remote apps have their own compiled assets. Other app images are gateways; their UI still executes from Hub. SUSM and ESPM are excluded from the app catalog. The legacy CI publication list and gateway manifests still require cleanup before publishing. Contact uses its existing public presentation route. This is independent frontend delivery, not backend isolation or extraction of Hub-native UI.

On each target, provision DNS/TLS and route each exact app hostname to its corresponding loopback port in `dockyard-<slug>.compose.yml`. Only a trusted HTTPS ingress may reach gateways: they forward HTTPS scheme and the incoming hostname to Hub. Reject unknown hosts at ingress. Set `HUB_UPSTREAM` to the privately reachable Hub address, not container-local localhost. Register Google's callback `https://<slug>.sorye.app/api/auth/callback/google` for each login-enabled app. Leave `AUTH_URL` unset so Auth.js uses the forwarded origin. Sessions are host-only: each app signs in on its own origin; no broad domain cookie is introduced. Hub must remain private behind trusted gateways because it trusts forwarded hosts.

Keep `/learn/...` available for public introductions. Do not configure root app hosts to reach Hub directly, which retains the older introduction redirect. Gateway `/` redirects to the app route; login callbacks and subsequent reloads retain that route.

Set runtime `AUTH_TRUST_HOST=true` only with private Hub access through that trusted ingress. Leave legacy `NEXTAUTH_URL` unset as well as `AUTH_URL`. Hub validates approved HTTPS hosts and reconstructs callback request URLs independently of Docker's `HOSTNAME=0.0.0.0` bind address. See [OAuth proxy verification](../docs/OAUTH-PROXY.md) for Traefik header trust, fresh-login checks, evidence and remaining deployment verification.

Authenticate the Dockyard service account to the private registry. Set `SORYE_APP_IMAGE` to the initial digest, `SORYE_APP_PORT` if overriding its default, and `HUB_UPSTREAM` in the administrator/service environment. Keep these values stable after registration. Register separately:

```sh
dockyard add sorye-tasks /srv/sorye/deploy/dockyard-tasks.compose.yml web
dockyard deploy sorye-tasks registry.example/team/sorye-tasks@sha256:<digest>
```

Repeat for each app. Register Hub separately using `dockyard-hub.compose.yml`; supply its image and target-owned env file. Prepare Hub's database, object storage and workers separately. The Hub volume preserves remaining file-backed metadata; this does not make multiple Hub writers safe. Back up and restore-test it.

For Hub-to-Rodrigo v2 calls, provision an Ed25519 private key as a target-owned secret file and set `RODRIGO_HUB_PRIVATE_KEY_PATH` in the host environment used by `dockyard-hub.compose.yml`. The compose service mounts it read-only at `/run/secrets/rodrigo_hub_signing_key` and sets `RODRIGO_PRIVATE_KEY_FILE` to that in-container path. Set `RODRIGO_BASE_URL` to Rodrigo's private HTTPS origin and `RODRIGO_KEY_ID` to the matching public-key-ring entry. Rodrigo separately needs its `RODRIGO_PUBLIC_KEYS_FILE` and secret `RODRIGO_PROVIDERS_FILE` mounts. Do not place the private key in the Hub env file or a browser-visible variable.

Dockyard applies one digest to every service in a registration. Never register different app images together. It updates with `--no-deps`; it does not provision ingress, databases, workers or credentials. Run `docker compose -f <file> config --quiet` before registering. Keep Compose project names stable. Promotion is an explicit `dockyard deploy` or `dockyard ship` action after publication; this workflow does not deploy automatically. Review the printed digest and promote each app independently. Dockyard's previous healthy release provides image rollback, not data rollback.

Gateway healthchecks prove the web process is alive, not authenticated end-to-end readiness. Before promotion, check login, workspace access, remote assets, a save/reload and an unauthorized workspace request through every public hostname. Test a failed deployment and recovery on a disposable target first.

## OCR worker deployment

Register `dockyard-ocr-worker.compose.yml` separately with service `worker` and promote the published `-worker` image digest using `SORYE_WORKER_IMAGE`. Start Hub first so its data volume exists. Run the worker on the same Docker host as Hub: the external `sorye-hub_hub_data` volume must be shared, not copied. Set `SORYE_HUB_DATA_VOLUME` if Hub uses a different project/volume name. Cross-host workers require shared object storage for source PDFs and review of remaining file-backed state before deployment.

Use the same target-owned `SORYE_HUB_ENV_FILE` and signing-key path as Hub. The worker requires the same PostgreSQL database/schema, file storage configuration, object-store credentials and encryption/signing settings. It runs with `STORE_DRIVER=postgres`, has no published port, and has its own resource limits. Set the model endpoint to an address reachable from this container; `localhost` refers to the worker, not the host GPU server. The model URL must also pass Hub's existing server-side allowlist.

The image installs production dependencies and uses `tsx` to load Hub and shared workspace source. The web image remains a separate Next.js standalone image. Worker health becomes fresh only after this process successfully renews its database heartbeat. A stale heartbeat makes container health fail and Hub rejects new OCR submissions. Docker's restart policy restarts exited processes; it does not restart a merely unhealthy container. Alert on unhealthy workers. Graceful shutdown releases the worker heartbeat and lets the existing lease/retry mechanism recover interrupted jobs.

Gateways accept up to 65 MiB per request so a 64 MiB PDF plus Hub's multipart allowance reaches the authenticated upload handler. Hub still enforces its own file, request and workspace limits. Configure the public ingress to allow the same request size.

The OCR public landing copy was reviewed and remains accurate: PDF extraction, review/export and optional configured AI analysis are unchanged. These changes supply the existing production worker and restore the supported upload boundary.

## Administration console gateway

`admin.sorye.app` is served by the same Hub through its own gateway registration, `dockyard-admin.compose.yml` (project `sorye-admin`, service `web`). Promote the published `-admin` image digest with `SORYE_ADMIN_IMAGE` and set `HUB_UPSTREAM` to Hub's internal URL. The gateway forwards only console pages and APIs, Auth.js, `/login`, `/_next` and backend discovery; `/` redirects to `/admin` and everything else is 404. It runs read-only with tmpfs for nginx runtime paths, 64 MiB memory and a 64 KB request body limit, and binds `127.0.0.1:${SORYE_ADMIN_PORT:-8130}` for the host ingress.

Hub enforces the same allowlist and the platform-administrator check itself; the gateway is defence in depth. Every proxy in front of Hub, including the customer ingress, must overwrite `X-Forwarded-Host`. The Operator gateway registration (`dockyard-operator.compose.yml`) was removed with the retired Operator app. DNS, TLS, the Google OAuth redirect URI, Rodrigo migration 005, rollback and the Operator retirement steps are in the [console runbook](../docs/admin/ADMIN-CONSOLE-RUNBOOK.md).
