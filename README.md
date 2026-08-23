# Sorye

A subscription-based app platform monorepo. The **Hub** is your workspace OS — sign in, pick apps, connect REST APIs, and launch micro-frontends.

## Structure

```
sorye/
├── apps/
│   ├── hub/           # Next.js shell — auth, launcher, MF host
│   ├── dashboard/     # Vite micro-frontend remote (first app)
│   ├── calendar/      # Vite micro-frontend — scheduling
│   └── notes/         # Vite micro-frontend — note taking
├── packages/
│   ├── sdk/           # Lit web components (@sorye/sdk)
│   ├── types/         # Shared catalog, plans, workspace models
│   └── db/            # Drizzle + Postgres client
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

Fill in Google OAuth credentials and `AUTH_SECRET`.

**Google OAuth redirect URI:** `http://localhost:3000/api/auth/callback/google`

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

Sign in with Google → open **Manage apps** → enable Canvas (and other apps) → launch from the hub.

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

# Without Corepack, same commands via the wrapper:
.\pn run setup
.\pn install
.\pn dev
```
