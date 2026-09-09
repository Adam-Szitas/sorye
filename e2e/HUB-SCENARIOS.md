# Hub E2E scenarios

Advanced coverage lives in `e2e/hub-advanced.spec.ts` (`@advanced`). Smoke journeys stay in `e2e/hub.spec.ts`. Run all Hub tests with `pnpm test:e2e -- --project=hub`. Hub must already be up (`pnpm dev`, `reuseExistingServer`). Playwright does not start Hub unless `E2E_START_HUB=1`.

Free-plan workspaces only have **two optional app slots**. Advanced tests may **swap** a non-Dashboard app off so Mail / Drive / Messenger / Storefront / Site can open.

## Must-have

| Area | Spec | What we assert |
|------|------|----------------|
| Launcher / dock / split | `@advanced` | Dock Home / Apps / Connect; Catalog **left** + Dashboard **right**; Split returns to both panes |
| Mail compose modal | `@advanced` | Mail opens; **Compose Sorye Mail** dialog (To / Subject / Message); Cancel or Send if a recipient exists |
| Messenger → Mail | `@advanced` | Messenger **in a Hub pane** (compose host); send a line; **Forward to Mail** opens the same compose dialog with a `Fwd:` subject |
| Contact email modal | `@advanced` + smoke | Public `/contact`; **Email Sorye** dialog fields; Close (no Send / mailto) |
| Catalog picker | `@advanced` + smoke | Catalog **pane**; **Manage enabled apps** → App Library |
| Drive search + preview | `@advanced` | Upload a tiny text file; Search; **Open** preview dialog |
| Protocolio / Canvas from Contact | `@advanced` | `/contact` **Try** buttons; remotes mount; no **How to use** overlay |
| Reports (admin) | `@advanced` | Skip if Reports tile missing; else page + volume chart **or** empty-range copy |
| Storefront enquiry | `@advanced` | Add to cart → Cart → **Place order request** |
| Site editor | `@advanced` | Editor loads (title + Add section). **No publish** |
| Notifications | `@advanced` | Bell opens **Notification center** (toasts only if one is already showing) |
| Dashboard | `@advanced` + smoke | Scroll; **App events** tab |
| Relay + event delivery | `@advanced` | Enable **App events** → Relay route Tasks → Messenger `#events` → create a Task → assert `#events` (and notification feed when present). Free plan: may swap Dashboard off after enabling events so Messenger + Tasks fit. |

## Skip / optional

| Area | Why |
|------|-----|
| Studio WebGPU sample | Already in `hub.spec.ts`: chrome + blocked **or** ready; sample part optional |
| OCR full PDF | Smoke upload chrome only (`hub.spec.ts`). No real document pipeline |
| Real SMTP / internet mail | In-workspace Mail only. Contact Send would open `mailto:` |
| Site publish / public `/s/…` | Flaky vs existing published slug |
| SUSM / ESPM | Own projects; Hub iframe skipped unless `ALLOW_LIVE_E2E=true` |
| Other companies’ data | Local `AUTH_DEV_BYPASS` workspace only |
