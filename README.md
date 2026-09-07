# Sorye

A subscription-based app platform monorepo. The **Hub** is your workspace OS — sign in, pick apps, connect REST APIs, and launch micro-frontends.

## Documentation

| Doc | Contents |
|-----|----------|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Core platform design — Hub, MF, events, storage |
| [docs/SECURITY.md](./docs/SECURITY.md) | Threat model and mitigations |
| [docs/apps/APPS.md](./docs/apps/APPS.md) | Every app in detail + communication patterns |

## Structure

```
sorye/
├── apps/
│   ├── hub/           # Next.js shell — auth, launcher, Catalog, Contact, MF host, all APIs
│   ├── dashboard/     # Workspace overview + App events toggle
│   ├── calendar/      # Scheduling
│   ├── notes/         # Note taking
│   ├── tasks/         # Kanban boards
│   ├── relay/         # Event routing UI
│   ├── protocolio/    # PDF template builder
│   ├── canvas/        # Collaborative boards
│   ├── devkit/        # API / embed developer tools
│   ├── messenger/     # Chat + #events feed
│   ├── ocr/           # PDF layout matrix → Protocolio
│   └── studio/        # WebGPU CAD mesh viewer + Too-much monitor
├── packages/
│   ├── sdk/           # Lit web components (@sorye/sdk)
│   ├── types/         # Shared catalog, plans, workspace models
│   └── db/            # Drizzle + Postgres client
├── docs/              # Architecture, security, per-app reference
└── turbo.json
```

## Database

**Recommended: PostgreSQL** — relational, Fly.io-native, and a good fit for users, workspaces, teams, subscriptions, and API connections. Stripe webhooks and audit logs map cleanly to SQL.

| Environment | `STORE_DRIVER` | `DATABASE_URL` |
|-------------|----------------|----------------|
| Local quick start | `json` (default) | not needed — uses `apps/hub/.data/store.json` |
| Local with Postgres | `postgres` | `postgresql://sorye:sorye@localhost:5432/sorye` |
| Fly.io production | `postgres` | set via `fly secrets set DATABASE_URL=...` |

### Local Postgres

```bash
pnpm db:up          # starts Postgres via docker compose
pnpm db:push        # applies schema (Drizzle)
```

In `apps/hub/.env.local`:

```
STORE_DRIVER=postgres
DATABASE_URL=postgresql://sorye:sorye@localhost:5432/sorye
```

### Fly.io Postgres

```bash
fly postgres create --name sorye-db
fly postgres attach sorye-db -a sorye-hub   # sets DATABASE_URL secret automatically
fly secrets set STORE_DRIVER=postgres
fly deploy
```

Env validation lives in `apps/hub/lib/env.ts`. Production rejects `STORE_DRIVER=json`.

## Quick start

### 1. Install pnpm (once)

This repo pins `pnpm@10.12.1` via `packageManager`. Pick one:

```bash
# Recommended — uses Node's Corepack (then plain `pnpm` works)
npm run setup
```

Or use the repo wrapper (no Corepack needed):

```powershell
# Windows PowerShell / cmd — from the repo root
.\pn run setup
.\pn install
.\pn dev
```

```bash
# macOS / Linux / Git Bash
chmod +x pn   # once
./pn run setup
./pn install
./pn dev
```

### 2. Install dependencies

```bash
pnpm install
# or:  .\pn install
```

### 3. Configure environment

```bash
cp .env.example apps/hub/.env.local
```

Fill in `AUTH_SECRET`. For local Hub, keep `AUTH_DEV_BYPASS=true` (already set in `.env.example`). Open http://localhost:3000 — you land in the launcher without Google.

**Never set `AUTH_DEV_BYPASS` on Fly.io.** Production boot fails if it is `true`. Deployed auth stays Google OAuth.

To exercise Google sign-in locally, set `AUTH_DEV_BYPASS=false` (or remove it) and fill:

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create a **Web application** OAuth client and set:

- **Authorized JavaScript origins:** `http://localhost:3000`
- **Authorized redirect URI:** `http://localhost:3000/api/auth/callback/google`

If the consent screen is in **Testing**, add your Google account under **Test users**. Sign in at `http://localhost:3000` (not `127.0.0.1`) in a regular Chrome, Edge, or Firefox window. Google blocks sign-in in Cursor Simple Browser and in Chrome launched with remote debugging (`This browser or app may not be secure`).

### 4. Run hub + apps

```bash
pnpm dev
# or:  .\pn dev
```

- Hub: http://localhost:3000
- Dashboard remote: http://localhost:3001
- Calendar remote: http://localhost:3003
- Notes remote: http://localhost:3004
- Tasks remote: http://localhost:3005
- Relay remote: http://localhost:3006
- Protocolio remote: http://localhost:3007
- Canvas remote: http://localhost:3008
- DevKit remote: http://localhost:3009
- Messenger remote: http://localhost:3010
- OCR remote: http://localhost:3011
- Studio remote: http://localhost:3012

Sign in (or open Hub locally with `AUTH_DEV_BYPASS=true`) → open **Manage apps** → enable Canvas (and other apps) → launch from the hub.

Team collaboration for Canvas: switch to a **team workspace**, create boards there, and teammates on the same workspace can open and edit the same board live.

## Architecture

| Concern | Implementation |
|---------|----------------|
| Auth | Google via Auth.js (NextAuth v5) |
| Billing | Admin-assigned plans now → Stripe later |
| Sub-apps | Module Federation (Vite remotes) |
| Connections | Outbound REST keys + **inbound embed widgets** |
| Workspaces | Personal (all plans) + Team (Pro/Enterprise) |
| Storage | JSON file store in `apps/hub/.data/` (dev) |

## Embed Sorye apps in your own product

Users enable apps in the hub App Library (whitelist). They can then create an **embed widget** under **Connections → Embed widgets**:

1. Whitelist your site origin (e.g. `https://app.example.com` or `http://localhost:5173`)
2. Pick which enabled apps the key may host
3. Copy the one-time API key and drop in the snippet

```html
<script src="http://localhost:3000/embed.js"></script>
<div id="sorye-notes" style="height:640px"></div>
<script>
  SoryeEmbed.mount('#sorye-notes', {
    app: 'notes',           // catalog slug
    key: 'sk_embed_...'     // from Connections
  });
</script>
```

How it works:

- `embed.js` calls `POST /api/embed/bootstrap` with your key + page origin
- Hub checks origin allowlist and that the app is in both the widget’s enabled list and the workspace `selectedAppIds`
- An iframe loads a chrome-less `/embed/[slug]` host with the same Module Federation app as the hub
- Hub APIs inside the iframe use a short-lived embed session cookie

Revoke a key anytime from Connections to cut off embeds.

After schema changes (Postgres): `pnpm db:push`

## Playwright E2E

Chromium journeys for Hub (Catalog, Dashboard, Studio, OCR), plus **local** SUSM and ESPM. Defaults are localhost, not Vercel. Hub tests use `AUTH_DEV_BYPASS=true` — they never need Google secrets.

Three terminals, then Playwright UI in **system Chrome** (from `D:\projects\sorye` — not `npx pnpm@10.12.1 …`):

```
# terminal 1 — Hub
pnpm dev                    # http://localhost:3000

# terminal 2 — ESPM (D:\MyESPM\ESPM)
cd D:\MyESPM\ESPM
npm start                   # http://localhost:4200

# terminal 3 — SUSM on :4201 (no sibling repo found; set SUSM_URL if needed)
```

```
pnpm test:e2e:ui
```

**Close any Cursor Simple Browser tab on 9323**, then open http://127.0.0.1:9323 in Chrome or Edge. If Run is greyed (Cursor already connected), close that tab, Ctrl+C UI, `pnpm test:e2e:ui` again.

```bash
pnpm test:e2e:headed          # visible Playwright Chromium, no UI server
pnpm test:e2e                 # headless
pnpm test:e2e -- --update-snapshots
```

Override targets with `HUB_URL`, `SUSM_URL`, `ESPM_URL` (must stay localhost unless `ALLOW_LIVE_E2E=true`). Authenticated SUSM/ESPM: `SUSM_EMAIL` / `SUSM_PASSWORD`, `ESPM_USERNAME` / `ESPM_PASSWORD` in `e2e/.env`. Details: [e2e/README.md](./e2e/README.md).

## Subscription tiers

| Plan | Apps | Connections | Teams |
|------|------|-------------|-------|
| Free | 2 | 1 | — |
| Starter | 5 | 3 | — |
| Pro | 12 | 10 | 1 team, 5 members |
| Enterprise | ∞ | ∞ | ∞ |

Plans are **admin-assigned** during local testing. Users pick apps within their limit; they cannot self-upgrade yet.

## Admin: assign a subscription

After a user signs in once (creates their record), assign a plan:

```bash
curl -X POST http://localhost:3000/api/admin/subscription \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: dev-admin-secret" \
  -d '{"email":"you@gmail.com","subscriptionId":"pro"}'
```

List users:

```bash
curl http://localhost:3000/api/admin/subscription \
  -H "x-admin-secret: dev-admin-secret"
```

## Adding a new micro-frontend app

1. Create `apps/<name>/` as a Vite + `@module-federation/vite` remote
2. Register in `packages/types/src/apps.ts` with `microFrontend` config
3. Set `status: 'available'` and `mountPath: '/apps/<slug>'`
4. Add the remote to `turbo dev` filters in root `package.json`

## Stripe (next phase)

`SubscriptionPlan.stripePriceId` placeholders are already in types. Wire up:

- Stripe Checkout on plan change
- Webhook to set `subscriptionSource: 'stripe'`
- Replace admin assignment for production

## Scripts

```bash
pnpm run setup        # once: enable Corepack + pin pnpm@10.12.1
pnpm install
pnpm dev              # hub + all remotes
pnpm dev:hub          # hub only
pnpm dev:dashboard    # dashboard remote only
pnpm dev:calendar     # calendar remote only
pnpm dev:notes        # notes remote only
pnpm build            # build all
pnpm test:e2e         # Playwright journeys + visual diffs (Hub :3000, SUSM, ESPM)
pnpm test:e2e:ui      # Playwright UI mode — best for local visual debugging

# Without Corepack, same commands via the wrapper:
.\pn run setup
.\pn install
.\pn dev
```
