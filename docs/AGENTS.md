# Agent guide — Sorye monorepo

Quick orientation for AI coding agents. First read the repository-root `AGENTS.md`, then read these references in order:

1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Hub, Module Federation, events, relay, storage, Docker boot order. Public diagram: `/architecture`
2. **[SECURITY.md](./SECURITY.md)** — Auth boundaries, SSRF, validation (`apps/hub/lib/security.ts`)
3. **[apps/APPS.md](./apps/APPS.md)** — Every app, ports, files, communication

Read the repository-root `AGENTS.md` first. The [static behavior tree](./APP-BEHAVIOR-TREE.html) shows the user and system flows and handlers; keep it and the [Markdown version](./APP-BEHAVIOR-TREE.md) updated in the same change whenever app behavior or integration edges change.

## Rules of thumb

- **Performance and reliability over everything.** Prefer measured, observable behavior that remains responsive and preserves data under concurrency, overload, and service failure. Do not assume that a lower-level language alone provides these outcomes.
- **Keep the application modular and independently scalable.** Maintain clear contracts between Hub, each micro-frontend, worker, database, storage service and infrastructure component. Use per-component health, resource limits, telemetry and deployment boundaries so measured bottlenecks can be scaled, rolled back or replaced independently.
- When a requested change moves away from performance, quality, security, reliability or modularity, state the specific consequence and recommend a safer direction before implementation. Do not silently implement a technically harmful direction.
- If navigation opens the wrong app, route, build, or content version, treat it as a reliability defect and a performance failure. Trace navigation state, route resolution, remote/build version, and cache behavior; fix the cause and verify repeat navigation and reloads. A user's report of the wrong version is actionable evidence of a defect.

- **Single source of truth:** `packages/types/src/*.ts` for domain models and app catalog
- **APIs live in Hub only:** remotes call `fetch('/api/...', { credentials: 'include' })`
- **No app-to-app calls:** use events, handoffs, or Messenger via Hub. Client path is `kernel.emit` / `kernel.navigate` from `@sorye/platform` (or the existing `emitWorkspaceEvent` helper). Do not import one app from another.
- **Kernel vs private state:** global signals live in the Hub host (`@sorye/platform/host`). Each app keeps UI state in `createAppStore` / `signal` (`@sorye/platform`). The kernel does not read private fields. Apps receive a read-only view.
- **Standalone remote:** `connectKernel` without a Hub `mount` context calls `/api/workspace`, `/api/notifications`, `/api/events`, and `/api/handoffs` with `credentials: 'include'`. Set `VITE_HUB_ORIGIN` when the remote origin is not Hub. Dev CORS is localhost-only and is off in production. `workspaceId` still comes from `ensureHubUser()`.
- **Workspace scope:** always derive `workspaceId` from `ensureHubUser()`, never from client body
- **New MF app:** catalog entry in `packages/types/src/apps.ts` → Vite federation `./mount` → root `package.json` dev filter → `docs/apps/APPS.md`. The Catalog app (`alwaysAvailable`) lists `APP_CATALOG` automatically; still update that entry and the docs in the same change (see `.cursor/rules/app-catalog.mdc`).
- **Hub-native app** (Catalog / Reports / Storefront / Site / Mail / Drive): `APP_CATALOG` + `apps/hub/components/` + wire in `hub-native-app.tsx` — no Vite remote or port. Reports is `adminOnly`. Contact is `presentationOnly` (`/contact`), not customer chrome. Site publishes `/s/[slug]` without login. Mail is an in-workspace mailbox plus optional connected IMAP/SMTP (not a public MX). Drive metadata uses the configured store; bytes use local `.data` in development and an S3-compatible object store in production.

## Common tasks

| Goal | Files |
|------|-------|
| Add workspace event | `packages/types/src/events.ts`, app `emit-event.ts` or `kernel.emit`, `apps/hub/lib/events.ts` |
| Kernel client / signals | `packages/platform`, `apps/hub/components/hub-kernel.tsx`, `apps/hub/components/micro-app-loader.tsx`. Reference app: `apps/tasks` |
| Route event to webhook | `apps/hub/lib/relay.ts`, Relay app UI |
| Cross-app payload | `apps/hub/lib/handoffs.ts`, `POST /api/handoffs` |
| Notification badge | `apps/hub/lib/notifications.ts`, `use-notifications.tsx` |
| Sentry telemetry | `packages/telemetry`, `apps/hub/instrumentation*.ts`, `docs/TELEMETRY.md` |
| Tasks / Notes / Calendar store | `packages/types/src/{tasks,notes,calendar}.ts`, `apps/hub/lib/store/workspace-docs*.ts`, `apps/hub/app/api/{tasks,notes,calendar}/route.ts` |
| OCR rows + Qwen pattern JSON | `packages/types/src/ocr-ai.ts`, `apps/hub/lib/ocr/*`, `apps/hub/app/api/ocr/**`, `apps/hub/lib/store/ocr-analyses*.ts`, `docker-compose.yml` profile `qwen` (`Qwen/Qwen3-8B`) |
| Register new app | `packages/types/src/apps.ts`, `apps/hub/lib/mf-remotes.ts`, `docs/apps/APPS.md` |
| Hub-native page (Catalog / Contact / Reports / Storefront / Site / Mail / Drive) | `packages/types/src/apps.ts`, `apps/hub/components/`, `hub-native-app.tsx` |
| Mail (workspace + IMAP accounts) | `packages/types/src/mail.ts`, `apps/hub/lib/mail.ts`, `apps/hub/lib/mail-imap.ts`, `apps/hub/app/api/mail/**` |
| Visual / E2E | `pnpm test:e2e` / `pnpm test:e2e -- --project=hub` (includes `hub-advanced.spec.ts`) / `pnpm test:e2e:ui` (open http://127.0.0.1:9323 in **system Chrome**, not Cursor) / `pnpm test:e2e:headed` — Hub `:3000`, ESPM `:4200`, SUSM `:4200` (`D:\Martina\app\susm`, or `SUSM_URL` if `--port 4201`). Scenarios: `e2e/HUB-SCENARIOS.md`. Do not open 9323 in Simple Browser. |

## Dev command

```bash
pnpm dev   # Hub :3000 + remotes :3001–3012
```

Typecheck Hub: `pnpm exec tsc --noEmit -p apps/hub`

Local Hub without Google: `AUTH_DEV_BYPASS=true` in `apps/hub/.env.local` (development only).
