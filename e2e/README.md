# Playwright E2E (local)

Visual + journey tests for **Sorye Hub**, **SUSM**, and **ESPM**. Chromium only.

Defaults are **localhost**, never Vercel. If a local app is down, that spec fails with a “start the local app” message instead of hitting production.

Playwright does not start Hub unless you set `E2E_START_HUB=1`.

## Three terminals, then UI in Chrome

From `D:\projects\sorye` (do **not** run `npx pnpm@10.12.1 test:e2e:ui`):

**Terminal 1 — Hub**

```bash
pnpm dev
```

http://localhost:3000

**Terminal 2 — ESPM** (Angular in `D:\MyESPM\ESPM`)

```bash
cd D:\MyESPM\ESPM
npm start
```

http://localhost:4200 (`ng serve`)

**Terminal 3 — SUSM**

No SUSM repo was found under `D:\projects`, `D:\MyESPM`, or `D:\git`. Start your SUSM app on **port 4201** so it does not collide with ESPM:

```bash
ng serve --port 4201
```

http://localhost:4201 — or set `SUSM_URL` if you use another local port.

**Then watch tests** (still from `D:\projects\sorye`):

```bash
pnpm test:e2e:ui
```

### Open Playwright UI in Chrome — not Cursor

Playwright UI at **http://127.0.0.1:9323** is a **single client**. If Cursor Simple Browser / IDE Chromium already opened that tab, Run is greyed or the suite already ran there.

1. Close any Cursor tab on port **9323**.
2. Leave the `pnpm test:e2e:ui` terminal running (it prints the URL and does **not** auto-open a browser).
3. In **system Chrome or Edge**, open http://127.0.0.1:9323
4. Press the green Play (Run all — F5). Test windows are Playwright-bundled Chromium with a dedicated `e2e/.pw-user-data` profile — not Cursor MCP Chrome and not your daily Chrome profile.

**If Run is greyed / tests already ran in Cursor:** close the Cursor tab on 9323 → Ctrl+C the UI command → `pnpm test:e2e:ui` again → open the URL in Chrome.

`pnpm test:e2e:ui` does **not** pass `--project=hub`. It opens `playwright.ui.config.ts`, which is a single **hub · susm · espm** project so the left tree lists `hub.spec.ts`, `susm.spec.ts`, and `espm.spec.ts`. Those specs navigate the **top-level** page to Hub (`localhost:3000`), SUSM (`localhost:4201`), and ESPM (`localhost:4200`) — not only a Hub iframe.

### If the sidebar only shows Sorye Hub

Playwright UI Mode stores Filters in the browser and, on a **fresh** load of `playwright.config.ts`, checks **only the first project** (`hub`). That is why a raw `playwright test --ui` looks like Hub-only.

1. Clear the **search** box at the top of the left sidebar (no `hub` grep).
2. Expand **Filters** (chevron next to the search box).
3. Enable every project checkbox: **hub**, **susm**, and **espm**, or the combined **hub · susm · espm**.
4. Status filters: leave **passed / failed / skipped / flaky** as you like; skipped authenticated tests still appear.
5. Click the green **Play** on the **Tests** toolbar (**Run all — F5**). Do not click Play only on `hub.spec.ts`.

Prefer `pnpm test:e2e:ui` so you do not have to fight that first-project default.

### Watch Chromium without the UI server

If 9323 stays painful (single client), skip UI Mode:

```bash
pnpm test:e2e:headed
```

Headless (CI / no window):

```bash
pnpm test:e2e
```

One app only (CLI projects in `playwright.config.ts`):

```bash
pnpm test:e2e -- --project=hub
pnpm test:e2e -- --project=susm
pnpm test:e2e -- --project=espm
```

Update visual baselines after intentional UI changes:

```bash
pnpm test:e2e -- --update-snapshots
```

## Prerequisites

1. `AUTH_DEV_BYPASS=true` in `apps/hub/.env.local` (never invent Google secrets).
2. If `STORE_DRIVER=postgres`, run `pnpm db:up` first.
3. Hub + remotes on :3000–:3012 via `pnpm dev` in this repo.
4. Local ESPM on :4200 (`D:\MyESPM\ESPM`, `npm start`) and local SUSM on :4201 (or `SUSM_URL`).

Authenticated SUSM/ESPM tests do **not** need Hub.

## Credentials (gitignored)

Copy placeholders from `.env.example` into `e2e/.env` (already gitignored) or set them in the shell. Empty → **authenticated** tests skip; **login-wall** tests still open the local app so you see SUSM/ESPM in Chromium.

| Env | Login field |
|-----|-------------|
| `SUSM_EMAIL` / `SUSM_PASSWORD` | E-mail address + Password |
| `ESPM_USERNAME` / `ESPM_PASSWORD` | Username + Password (`espm-beta`); production myespm.eu uses “User name” |

PowerShell (current session only):

```powershell
$env:SUSM_EMAIL="..."
$env:SUSM_PASSWORD="..."
$env:ESPM_USERNAME="..."
$env:ESPM_PASSWORD="..."
```

Do not commit `e2e/.env`.

### URL overrides

| Env | Default |
|-----|---------|
| `HUB_URL` | `http://localhost:3000` |
| `SUSM_URL` | `http://localhost:4201` |
| `ESPM_URL` | `http://localhost:4200` |
| `E2E_START_HUB` | unset — Playwright will not auto-start `pnpm dev` |
| `ALLOW_LIVE_E2E` | unset — non-localhost URLs are rejected. Set `true` only to hit Vercel / myespm.eu |

Hub **Catalog** still iframes the Vercel URLs for in-app embeds. Those Hub embed specs skip unless `ALLOW_LIVE_E2E=true`. Full-page local journeys are `susm.spec.ts` / `espm.spec.ts`.

## Locators

Selectors live in `e2e/locators/` — one file per app. Specs and `e2e/helpers.ts` call `loc(page, …)` or the small `hubLogin` / `susmLogin` / `espmLogin` helpers. Do not put raw CSS or role names in the spec files.

| App | File | Login constants |
|-----|------|-----------------|
| Hub | `e2e/locators/hub.ts` | `HubLogin` |
| SUSM | `e2e/locators/susm.ts` | `SusmLogin` |
| ESPM | `e2e/locators/espm.ts` | `EspmLogin` |

To retarget a login field, edit that object (`role` / `name` / `label` / `text` / `css`). `loc()` uses the first strategy that is set: **role → label → text → css**. Keep `role` for accessible queries; delete `role` (and `name`) to fall back to `css`.

## Scenarios

- **Hub:** launcher without Google, Catalog + Manage apps, Dashboard, Studio (sample part if WebGPU), OCR upload chrome. Screenshots mask the status-bar clock.
- **SUSM:** login-wall smoke (always opens the local app); if credentials are set — sign in, Projects list, open a project (or open create and dismiss). Snapshots mask emails / user chips.
- **ESPM:** login-wall smoke (always opens the local app); if credentials are set — sign in, a core list (Works / Orders / …), view or open create and dismiss. Snapshots mask emails / user chips.
- **Hub iframe:** skipped unless `ALLOW_LIVE_E2E=true` (Catalog still points at Vercel). Full-page SUSM/ESPM journeys live in `susm.spec.ts` / `espm.spec.ts`.
