# Agent guide — Sorye monorepo

Quick orientation for AI coding agents. Read these in order:

1. **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Hub, Module Federation, events, relay, storage
2. **[SECURITY.md](./SECURITY.md)** — Auth boundaries, SSRF, validation (`apps/hub/lib/security.ts`)
3. **[apps/APPS.md](./apps/APPS.md)** — Every app, ports, files, communication

## Rules of thumb

- **Single source of truth:** `packages/types/src/*.ts` for domain models and app catalog
- **APIs live in Hub only:** remotes call `fetch('/api/...', { credentials: 'include' })`
- **No app-to-app calls:** use events, handoffs, or Messenger via Hub
- **Workspace scope:** always derive `workspaceId` from `ensureHubUser()`, never from client body
- **New MF app:** catalog entry in `packages/types/src/apps.ts` → Vite federation `./mount` → root `package.json` dev filter → `docs/apps/APPS.md`. The Catalog app (`alwaysAvailable`) lists `APP_CATALOG` automatically; still update that entry and the docs in the same change (see `.cursor/rules/app-catalog.mdc`).
- **Hub-native app** (like Catalog / Contact): `APP_CATALOG` + `apps/hub/components/` + wire in `app-workspace.tsx` — no Vite remote or port.

## Common tasks

| Goal | Files |
|------|-------|
| Add workspace event | `packages/types/src/events.ts`, app `emit-event.ts`, `apps/hub/lib/events.ts` |
| Route event to webhook | `apps/hub/lib/relay.ts`, Relay app UI |
| Cross-app payload | `apps/hub/lib/handoffs.ts`, `POST /api/handoffs` |
| Notification badge | `apps/hub/lib/notifications.ts`, `use-notifications.tsx` |
| Register new app | `packages/types/src/apps.ts`, `apps/hub/lib/mf-remotes.ts`, `docs/apps/APPS.md` |
| Hub-native page (Catalog / Contact) | `packages/types/src/apps.ts`, `apps/hub/components/`, `app-workspace.tsx` |
| Visual / E2E | `pnpm test:e2e` / `pnpm test:e2e:ui` (open http://127.0.0.1:9323 in **system Chrome**, not Cursor) / `pnpm test:e2e:headed` — Hub `:3000`, ESPM `:4200`, SUSM `:4201`. Do not open 9323 in Simple Browser. |

## Dev command

```bash
pnpm dev   # Hub :3000 + remotes :3001–3012
```

Typecheck Hub: `pnpm exec tsc --noEmit -p apps/hub`

Local Hub without Google: `AUTH_DEV_BYPASS=true` in `apps/hub/.env.local` (development only).
