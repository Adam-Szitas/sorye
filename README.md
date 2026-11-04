# Sorye

Sorye is a workspace app built around the **Hub**. People sign in, choose apps from the catalog, and use them in one shared workspace. The Hub provides authentication, navigation, APIs, and storage; most app screens are independently built Module Federation remotes.

## Run locally

You need Node.js 20 or newer and pnpm 10.12.1. The repository pins the pnpm version in `package.json`.

```bash
corepack enable
pnpm install
```

Copy [.env.example](./.env.example) to `apps/hub/.env.local` (`cp .env.example apps/hub/.env.local`, or `Copy-Item .env.example apps/hub/.env.local` in PowerShell), then set a local `AUTH_SECRET`. The example enables `AUTH_DEV_BYPASS=true` for local development, so Google OAuth is optional there. Production rejects that bypass.

```bash
pnpm dev
```

Open **http://localhost:3000**. Hub runs on port 3000; `pnpm dev` also starts the Sorye app remotes. Open **Manage apps** in Hub to enable an app and launch it. Use `pnpm dev:hub` only when the remote apps are already running separately.

On Windows, use `pnpm.cmd` in PowerShell if script execution blocks `pnpm.ps1`. The repository also provides `pn.cmd` as a wrapper.

## Data and services

Local development uses the JSON store by default. For PostgreSQL, run `pnpm db:up`, set `STORE_DRIVER=postgres` and `DATABASE_URL` in `apps/hub/.env.local`, then run `pnpm db:push`. Production requires PostgreSQL. See [local database setup](./docs/LOCAL-DATABASE.md), [OCR setup](./docs/OCR-LOCAL-SETUP.md), and [Protocolio integration](./docs/PROTOCOLIO.md) when working on those services.

## Build and test

```bash
pnpm build
pnpm test:e2e -- --project=hub
```

End-to-end tests cover Sorye Hub and its in-repository apps. Start `pnpm dev` before running them, or set `E2E_START_HUB=1` to let Playwright start it. See the [E2E guide](./e2e/README.md) for headed, UI, and screenshot commands.

## Repository map

| Path | Purpose |
| --- | --- |
| `apps/hub/` | Next.js shell, authentication, workspace APIs, and Hub-native screens |
| `apps/*/` | Sorye app remotes such as Dashboard, Tasks, OCR, and Canvas |
| `packages/types/` | Shared contracts and app catalog |
| `packages/platform/` | Hub kernel and app integration |
| `packages/sdk/` | Shared UI components |
| `packages/db/` | PostgreSQL schema and client |
| `e2e/` | Sorye Hub browser journeys |

## Further reading

| Guide | Use it for |
| --- | --- |
| [Architecture](./docs/ARCHITECTURE.md) | Hub, remotes, events, and storage boundaries |
| [App catalog](./docs/apps/APPS.md) | App ownership, ports, and integration paths |
| [Behavior map](./docs/APP-BEHAVIOR-TREE.md) | User flows and state owners ([visual version](./docs/APP-BEHAVIOR-TREE.html)) |
| [Security](./docs/SECURITY.md) | Authentication and API boundaries |
| [Forgejo image publishing](./docs/FORGEJO-IMAGE.md) | Manual Hub image builds and Dockyard handoff |
| [Contributor guide](./AGENTS.md) | Rules for changing the repository |
