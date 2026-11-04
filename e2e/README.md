# Sorye end-to-end tests

Playwright exercises Sorye Hub and its in-repository apps. The suite uses Chromium and targets `http://localhost:3000` by default. It does not require another application repository.

## Run

Start Sorye in one terminal:

```bash
pnpm dev
```

Run the browser tests in another:

```bash
pnpm test:e2e
```

For an interactive browser, use `pnpm test:e2e:headed`. For Playwright UI, run `pnpm test:e2e:ui`, then open the displayed URL (normally `http://127.0.0.1:9323`) in system Chrome or Edge. Close any other Playwright UI tab on that port first. The UI runner does not open a browser automatically.

Set `E2E_START_HUB=1` if Playwright should start `pnpm dev` when Hub is down. Set `HUB_URL` to another local Hub URL when needed. Non-local targets require an explicit `ALLOW_LIVE_E2E=true`. `PLAYWRIGHT_UI_PORT` changes the UI server port.

Set `AUTH_DEV_BYPASS=true` in `apps/hub/.env.local` for local tests; they do not need Google credentials. If Hub uses PostgreSQL locally, start it with `pnpm db:up` and apply the schema with `pnpm db:push` before testing.

## Coverage

`hub.spec.ts` checks launcher, catalog, Dashboard, Studio, and OCR smoke journeys. `hub-advanced.spec.ts` covers split panes, Mail, Messenger, Drive, Contact, Storefront, Site, Reports, Relay, and notifications. See [HUB-SCENARIOS.md](./HUB-SCENARIOS.md) for the detailed matrix.

Visual baselines live beside `hub.spec.ts`. Update them only after an intentional UI change:

```bash
pnpm test:e2e -- --update-snapshots
```

Selectors live in `e2e/locators/hub.ts`; reusable browser steps are in `e2e/helpers.ts`.
