# Sorye VM, delivery and operations architecture

**Principle: Performance and quality.** Keep the product modular, observable and independently scalable. If a requested change would undermine performance, quality, security or reliability, the developer or agent must state the concrete risk and recommend a better direction before implementation. A product owner may still choose the trade-off knowingly.

This is a target design for the existing Proxmox environment, not a description of deployed infrastructure. It assumes each service VM uses Docker Compose initially. It deliberately separates hypervisor control, source/build/release, application operations and backup authority. No single internet-facing control panel should have unrestricted root access to every layer.

## Target structure

```mermaid
flowchart TB
  Dev[Developer] -->|commit and push| Git[Git manager VM\nForgejo or Gitea]
  Git --> CI[Isolated CI runner VM\nchecks, tests, build, SBOM]
  CI --> Registry[Private OCI registry\nimmutable image digest]
  CI --> Stage[Staging deploy controller\nAnsible over private network]
  Stage --> ST[Staging app VM(s)\nDocker Compose]
  ST --> Acceptance[Automated smoke + manual acceptance]
  Acceptance -->|approved release tag| Release[Production release controller\nprotected manual gate]
  Registry --> Release
  Release --> PR[Production app VM pool\nHub + independently scaled remotes/workers]
  PR --> DB[(Postgres VM/service\nprivate network, PITR)]
  PR --> Obj[(S3-compatible object storage\nfile bytes, versioning)]
  PVE[Proxmox VE cluster] --> Git
  PVE --> CI
  PVE --> ST
  PVE --> PR
  PVE --> DB
  PVE --> Obj
  PVE --> PBS[Proxmox Backup Server\nseparate failure domain]
  PBS --> Offsite[Offsite PBS replica / encrypted copy]
  PR --> OTel[Per-VM OpenTelemetry Collector\nmetrics, traces, logs]
  DB --> OTel
  CI --> OTel
  OTel --> Obs[Observability VM pair\nPrometheus or VictoriaMetrics\nGrafana + Loki + Tempo]
  Sentry[Browser error and Web Vitals\nSentry or OTel browser SDK] --> Obs
  PVE --> PVEStats[Proxmox host/VM metrics + alerts]
  PVEStats --> Obs
  PVE --> PVEManager[Proxmox UI/API\nVM lifecycle and capacity]
  DockerMgr[Portainer or Compose GitOps\ncontainer inventory/actions] --> ST
  DockerMgr --> PR
```

The diagram uses independent boundaries: CI creates an immutable artifact; deploy controllers promote that exact artifact; app VMs do not build releases. Monitoring receives data from the application and infrastructure planes. Backups leave the app VM and hypervisor failure domain. The Docker manager receives restricted access to its environments, not cluster-admin credentials for Proxmox or database credentials.

## Recommended ownership and tools

| Concern | Reasonable starting choice | Boundary and scaling rule |
|---|---|---|
| VM lifecycle | Proxmox VE cluster UI/API | Keep Proxmox as the source of truth for VM/CT lifecycle, host placement, resource assignment and VM metrics. Add a separate automation service account with narrowly scoped API permissions. |
| Source and CI | **Forgejo** on a small dedicated VM; isolated ephemeral Forgejo Runners on separate CI VM(s) | Forgejo is the recommended starting Git host. It stores source and workflow definitions while separate runners execute jobs. Do not mount the Proxmox socket, production Docker socket, backup datastore, or production secrets into CI. Build once and push by digest. Gitea remains a viable alternative, but choose one host deliberately and validate workflow compatibility before migration; their Actions implementations are similar, not identical. |
| Container operations | Ansible/Compose as GitOps source of truth; optional Portainer for inventory and bounded operational actions | Compose remains declarative. A UI can show status and restart a service, but changes must flow back to versioned configuration. Do not let two tools independently own desired state. |
| Staging/production releases | Separate deploy controller identities and inventories, ideally Ansible over a private management VLAN | Every deploy uses a tested image digest. Staging auto-deploys after CI. Production requires a protected tag and manual approval at first; automation can follow after rollback and migration safety are proven. |
| Image storage | Private OCI registry (Forgejo/Gitea registry or dedicated registry) | Immutable tags/digests, retention, vulnerability scan, SBOM, signing. Mirror critical images offsite; registry loss must not prevent rollback if images are retained elsewhere. |
| VM/container telemetry | OpenTelemetry SDKs plus one Collector agent per VM; Proxmox exporter/API collector | Metrics, traces and logs use common service, environment, version, VM and app identifiers. Set retention and cardinality limits. Never use user IDs, email, document names or arbitrary URLs as metric labels. |
| Dashboards/alerts | Prometheus for initial scale; VictoriaMetrics if retention/series scale warrants it; Grafana | Grafana is the common view, not the data source. Alert on symptoms and saturation: p95/p99 latency, error rate, queue age, CPU throttling, memory pressure, disk, DB pool wait, storage failures, backup freshness. |
| Frontend quality | Sentry browser telemetry or OpenTelemetry browser SDK plus Web Vitals | Tag release, app ID, route class and browser family. Capture JS exceptions, failed requests, navigation timing, LCP/INP/CLS and long tasks. Scrub content, cookies, tokens and personal data. Measure each remote separately. |
| Logs/traces | Loki and Tempo are reasonable Grafana-native choices; alternatives can receive OTLP | Keep searchable logs structured and bounded. Sample traces under high load while preserving errors and slow traces. Propagate trace IDs Hub → remote API → worker → DB/external integration. |
| Backups | Proxmox Backup Server on separate hardware/failure domain, with remote sync/offsite copy | Back up VM/CT state and configuration. Use database-native consistent backups/PITR and object-store versioning/replication in addition to VM backups. Schedule verification and perform restore drills. A green backup job is not a restore test. |
| Secrets | Dedicated secret manager, or initially Ansible Vault plus per-environment protected secrets | Separate dev/stage/prod credentials. CI gets short-lived deploy credentials only. Rotate and audit. Do not store plaintext secrets in Git, Compose files, VM images or telemetry. |

Forgejo is the recommended self-hosted Git manager for this proposal because its integrated Actions model delegates execution to separately installed runners, matching the desired VM isolation. Gitea is a viable alternative with a similar but not fully interchangeable Actions model. If the existing Sorye repo already lives in a trusted external Git host, keep it and add a private runner and deploy controller rather than moving it solely for architectural neatness. Whichever host is chosen, keep builds portable: OCI artifacts, digest-based promotion, explicit secrets and deployment contracts reduce dependence on host-specific workflows.

## Delivery path

1. Developer pushes a branch. CI runs formatting/lint/typecheck, unit and integration tests, dependency/security checks, schema migration validation, build, and container health checks.
2. CI creates an SBOM, scans and signs the image, then publishes an immutable OCI digest. CI does not build a second image for staging or production.
3. Staging auto-deploys that digest into an isolated staging environment with synthetic data and separate credentials. Run migration checks, smoke tests, app-by-app flows, browser checks, failure tests, and load profiles there.
4. A protected release tag records the exact digest and migration version. The initial production gate is manual. The release controller checks staging evidence, backup freshness and migration compatibility, then deploys using a canary or rolling process.
5. Watch service-level indicators during rollout. Automatically halt on health-check failure or agreed error/latency regression; rollback the image if the migration is backward-compatible. Database changes follow expand/migrate/contract so app rollback remains possible.
6. After a stable observation window, mark the release complete. Keep the previous image digest, configuration version and restore point available.

Development and staging must be separate from production at the network, credentials, data and deploy-role levels. Do not copy production personal data into staging. Staging should model resource shape and traffic patterns closely enough for meaningful tests, but it does not need full production capacity at all times.

## Sorye modularity and independent scaling

The Hub remains the authenticated shell and shared API boundary. Each Module Federation remote is separately built, versioned, measured and deployable. Hub remote configuration pins compatible remote versions. APIs are versioned contracts; shared domain types live in `packages/types`. No remote imports another remote. Use the Hub, events, handoffs or a versioned API for cross-app behavior.

Separate workloads by resource profile: interactive Hub/API, static remote assets, Postgres, object storage, OCR/PDF workers and Relay/outbox workers. Start with one instance of each class where needed, then scale only the measured bottleneck. Suitable first scale-out axes include Hub stateless replicas, per-remote asset delivery/CDN, worker concurrency, DB connection/IO capacity, and storage throughput. GPU inference has a separate capacity plan and admission limit. Keep worker queues bounded and expose queue age so capacity pressure is visible before users time out.

The current Hub with Docker Compose does not provide general automatic horizontal scaling. Proxmox can provision larger or additional VMs, but scheduling containers across hosts and automatically scaling them is a separate orchestration capability. First use repeatable templates and measured manual capacity changes. Add Kubernetes or another orchestrator only when multiple-node scheduling, service discovery, rollout automation and autoscaling justify its operational cost. Never call a Compose restart policy autoscaling.

## Monitoring model

Use four useful dimensions consistently: **service/app**, **environment**, **release**, and **instance/VM**. Dashboard both service aggregates and per-instance detail so an average cannot hide one overloaded remote or VM.

- **Frontend per app:** active users/sessions (privacy-preserving aggregation), route navigation and resource timing, Web Vitals, JS errors, failed API calls, long tasks, bundle/remote load failures, browser/device class.
- **Hub/API:** request volume, p50/p95/p99 latency, status/error rates, event-loop lag, CPU/memory, connection pools, database wait/query time, outbound call latency, rate limits, auth failures.
- **Micro-frontend:** remote entry load success/time by app and release; app-level API and render errors; app-specific interaction timing. Module Federation remotes must initialize telemetry with app/version identity.
- **Workers:** queued/running/failed jobs, queue wait, processing duration, retries, cancellation, memory/CPU, OCR GPU utilization/VRAM and model response time.
- **Database/storage:** connections and pool waits, slow queries, locks, disk/IOPS, replication lag/PITR status, object request latency/errors, capacity, versioning/replication state.
- **VM/Docker/Proxmox:** host load, CPU steal, memory pressure, disk latency/free space, network, VM/container restarts, throttling, temperatures/SMART where available, backup status and capacity forecasts.

Every dashboard needs an owner and an alert threshold tied to user impact. Add explicit SLOs only after baseline measurements. High-cardinality data such as per-user or per-file IDs belongs in traces/logs with access controls, not time-series labels. Alert routes must remain available when the production app itself is down.

## Database and storage choices

The app may support multiple database endpoints and engines only behind a tested adapter contract. Start with PostgreSQL as the supported durable engine because the current schema and Drizzle store are PostgreSQL-specific. For multiple connections, define named roles (Hub control-plane DB, workspace data DB, analytics/read replica) and explicit workspace routing; never accept arbitrary client-supplied connection strings. Encrypt credentials, enforce network egress allowlists, rate-limit connection tests, cap pools globally, and define migrations/backups/restore tests for every supported engine. Add MySQL/SQLite only when a user need and a complete compatibility test matrix justify the ongoing engineering cost.

Use object storage for user file bytes. Keep file metadata, workspace authorization and lifecycle in Hub/Postgres. Configure bucket versioning, encryption, retention and offsite replication. Database backups and object backups must be coordinated enough to restore metadata and bytes from compatible points.

## VM and network layout

Recommended logical zones: (1) public ingress/reverse proxy, (2) app and workers, (3) databases/object storage, (4) Git/CI/deploy control plane, (5) monitoring, and (6) backup. Permit only required flows between VLANs. Expose public HTTPS through a reverse proxy; do not expose Docker APIs, Postgres, Proxmox, PBS, Grafana, or CI runners directly to the internet. Management tools require VPN/SSO/MFA, named accounts, audit logs and least privilege. A compromise of app workloads must not grant hypervisor or backup deletion rights.

Proxmox is the VM lifecycle/control plane. A container UI such as Portainer is optional operational convenience inside the Docker layer. Ansible/GitOps owns reproducible desired state. PBS owns VM/CT backup operations. Grafana is for visibility. Keeping these roles separate limits the blast radius of one compromised credential and makes tool ownership clear.

## Phased implementation

**Phase 1 — inventory and safety:** map current VMs, Docker hosts, ports, data paths, traffic, credentials and backups. Record recovery objectives. Confirm independent backup target and one successful restore before moving services.

**Phase 2 — delivery foundation:** establish Git manager (if needed), isolated CI runner, immutable registry, staging environment, release tags, protected manual production gate, and rollback process. Package current Compose services with health checks and resource limits.

**Phase 3 — observability:** instrument Hub and every remote, then DB, workers, Docker VMs and Proxmox. Add release IDs, dashboards, alert routing, retention and privacy filtering. Gather baseline peaks and quiet-period measurements.

**Phase 4 — data/reliability:** move shared state and file bytes to durable services, make schema migrations reversible where possible, configure DB PITR and object versioning, and add job/outbox/realtime failure recovery.

**Phase 5 — scale:** load-test realistic Hub, each remote, database, object and worker workload. Identify the component causing tail latency or errors. Resize or replicate that component only, then repeat. Evaluate orchestration when manual deployment/scheduling itself becomes a measured bottleneck.

## Decisions to make before production rollout

- VM count, host count, CPU/RAM/storage/network and whether Proxmox is a single node or cluster.
- Git host preference and whether CI can use an isolated runner VM.
- Staging/prod DNS, reverse proxy, VPN/MFA and network segmentation.
- Off-host/offsite backup target, retention, RPO/RTO and restore owner.
- Object storage provider and credentials/egress model.
- Telemetry retention, alert channel, data privacy policy and SLO owners.
- Which production deployments require human approval and who is the approver.

## References

- [Proxmox VE administration guide](https://pve.proxmox.com/pve-docs/pve-admin-guide.html) and [API viewer](https://pve.proxmox.com/pve-docs/api-viewer/)
- [Proxmox Backup Server storage and remote sync guidance](https://pbs.proxmox.com/docs/storage.html) and [installation guidance](https://pbs.proxmox.com/docs/installation.html)
- [Gitea Actions quick start](https://docs.gitea.com/usage/actions/quickstart/)
- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/), [JS exporters](https://opentelemetry.io/docs/languages/js/exporters/)
- [Prometheus overview](https://prometheus.io/docs/introduction/overview/)
- [Portainer environments](https://docs.portainer.io/admin/environments/add)
