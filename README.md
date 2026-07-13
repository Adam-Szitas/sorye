# Sorye

A subscription-based app platform monorepo. The **Hub** is your workspace OS — sign in, pick apps, connect REST APIs, and launch micro-frontends.

## Structure

```
sorye/
├── apps/
│   ├── hub/           # Next.js shell — auth, launcher, MF host
│   └── dashboard/     # Vite micro-frontend remote (first app)
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

### 1. Install

```bash
npx pnpm@10.12.1 install
```

### 2. Configure environment

```bash
cp .env.example apps/hub/.env.local
```

Fill in Google OAuth credentials and `AUTH_SECRET`.

**Google OAuth redirect URI:** `http://localhost:3000/api/auth/callback/google`

### 3. Run hub + dashboard

```bash
npx pnpm@10.12.1 dev
```

- Hub: http://localhost:3000
- Dashboard remote: http://localhost:3001

Sign in with Google → pick apps → open **Dashboard** from the launcher.

## Architecture

| Concern | Implementation |
|---------|----------------|
| Auth | Google via Auth.js (NextAuth v5) |
| Billing | Admin-assigned plans now → Stripe later |
| Sub-apps | Module Federation (Vite remotes) |
| Connections | REST API + API key per endpoint |
| Workspaces | Personal (all plans) + Team (Pro/Enterprise) |
| Storage | JSON file store in `apps/hub/.data/` (dev) |

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
pnpm dev              # hub + dashboard
pnpm dev:hub          # hub only
pnpm dev:dashboard    # dashboard remote only
pnpm build            # build all
```
