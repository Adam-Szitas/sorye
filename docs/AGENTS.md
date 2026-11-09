# Agent guide — Sorye monorepo

**Architecture steering:** Apps talk to Hub; Hub talks to Rodrigo. Keep Hub as the browser/session and API gateway. Rodrigo is the intended owner of backend domain operations, fetching, durable events and service coordination. Existing Hub implementations are migration work, not a reason to add permanent backend ownership there. Read [HUB-RODRIGO-BOUNDARY.md](HUB-RODRIGO-BOUNDARY.md); distinguish current behavior from target behavior in changes and reports.

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
- **Browser-facing APIs live in Hub:** remotes call `fetch('/api/...', { credentials: 'include' })`. Hub delegates migrated slices through the signed v2 Rodrigo contract; Rodrigo lives in its own repository and receives server-derived user/workspace claims. Browser apps do not call Rodrigo or databases directly. The current migration list and uncovered Hub-owned paths are tracked in [the durable data contract](RODRIGO-DATA-CONTRACT.md); do not use the legacy `RODRIGO_DOCUMENT_OWNERS` forwarding path for the v2 no-migration cutover.
- **No app-to-app calls:** use events, handoffs, or Messenger via Hub. Client path is `kernel.emit` / `kernel.navigate` from `@sorye/platform` (or the existing `emitWorkspaceEvent` helper). Do not import one app from another.
- **Kernel vs private state:** global signals live in the Hub host (`@sorye/platform/host`). Each app keeps UI state in `createAppStore` / `signal` (`@sorye/platform`). The kernel does not read private fields. Apps receive a read-only view.
- **Standalone remote:** `connectKernel` without a Hub `mount` context calls `/api/workspace`, `/api/notifications`, `/api/events`, and `/api/handoffs` with `credentials: 'include'`. Set `VITE_HUB_ORIGIN` when the remote origin is not Hub. Dev CORS is localhost-only and is off in production. `workspaceId` still comes from `ensureHubUser()`.
- **Workspace scope:** always derive `workspaceId` from `ensureHubUser()`, never from client body. Member lists that span Personal and Work use `partitionUserLoad` (`apps/hub/lib/user-load.ts`) over `session.workspaces`. Personal sections are included only when that app is in the viewer's personal workspace subscription (selected apps plus always-available apps). Team lists are not filtered by the personal package. `mergeUserLoad` stays server-side and is not sent to list UIs. Writes stay on the active workspace.
- **New MF app:** catalog entry in `packages/types/src/apps.ts` → Vite federation `./mount` → root `package.json` dev filter → `docs/apps/APPS.md`. The Catalog app (`alwaysAvailable`) lists `APP_CATALOG` automatically; still update that entry and the docs in the same change (see `.cursor/rules/app-catalog.mdc`).
- **Hub-native app** (Catalog / Reports / Operator / Storefront / Site / Mail / Drive): `APP_CATALOG` + `apps/hub/components/` + wire in `hub-native-app.tsx` — no Vite remote or port. Reports and Operator are `adminOnly` + `alwaysAvailable` (no plan slot; hidden from members). Operator is the platform-operator dashboard (health, plans, notices). Reports stays workspace event charts. Contact is `presentationOnly` (`/contact`), not customer chrome. Site publishes `/s/[slug]` without login. Mail is an in-workspace mailbox plus optional connected IMAP/SMTP (not a public MX). Drive metadata uses the configured store; bytes use local `.data` in development and an S3-compatible object store in production.
- **App chrome:** The product navbar is the Hub shell top bar (`apps/hub/components/top-bar.tsx` and `language-selector.tsx`), mounted by `hub-shell.tsx`. It stays visible while an app is open. It holds the language switcher and the Hub button, which calls `navigatePanel('launcher')` and leaves the app mounted. Do not add a second navbar in a remote; keep that app's own tools in the app. Pages outside the shell use `StandaloneAppBar` / `StandaloneFrame` from `@sorye/platform/react` (`packages/platform/src/chrome.tsx`): Vite `main.tsx`, `/apps/[slug]`, and the OCR reading page. Edit the shell bar or `chrome.tsx`. Do not copy a private navbar into each app.

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
| Personal / Work list split | `apps/hub/lib/user-load.ts`, `apps/hub/lib/user-load-read.ts`, `packages/platform/src/user-load-sections.tsx` |
| OCR rows + Qwen pattern JSON | `packages/types/src/ocr-ai.ts`, `apps/hub/lib/ocr/*`, `apps/hub/app/api/ocr/**`, `apps/hub/lib/store/ocr-analyses*.ts`, `docker-compose.yml` profile `qwen` (`Qwen/Qwen3-8B`) |
| Register new app | `packages/types/src/apps.ts`, `apps/hub/lib/mf-remotes.ts`, `docs/apps/APPS.md` |
| Hub-native page (Catalog / Contact / Reports / Operator / Storefront / Site / Mail / Drive) | `packages/types/src/apps.ts`, `apps/hub/components/`, `hub-native-app.tsx` |
| Navbar, language, or back to the Hub menu | Shell: `apps/hub/components/top-bar.tsx`, `language-selector.tsx`. Outside the shell: `packages/platform/src/chrome.tsx` (`StandaloneAppBar`). Do not copy a navbar into each remote. |
| Mail (workspace + IMAP accounts) | `packages/types/src/mail.ts`, `apps/hub/lib/mail.ts`, `apps/hub/lib/mail-imap.ts`, `apps/hub/app/api/mail/**` |
| Visual / E2E | `pnpm test:e2e` / `pnpm test:e2e -- --project=hub` (includes `hub-advanced.spec.ts`) / `pnpm test:e2e:ui` (open http://127.0.0.1:9323 in **system Chrome**, not Cursor) / `pnpm test:e2e:headed` — Sorye Hub `:3000` and its remotes. Scenarios: `e2e/HUB-SCENARIOS.md`. Do not open 9323 in Simple Browser. |

## Dev command

```bash
pnpm dev   # Hub :3000 + remotes :3001–3012
```

Typecheck Hub: `pnpm exec tsc --noEmit -p apps/hub`

Local Hub without Google: `AUTH_DEV_BYPASS=true` in `apps/hub/.env.local` (development only).
