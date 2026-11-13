# Prompt: Sorye website builder — component SDK + CMS (evolving the Site app)

Turn Sorye's **Site** app into a builder for **presentational websites**: a component SDK, a CMS where the workspace sets up the whole site and stores data, optional internationalization, and notifications by mail through Messenger or a connected Relay route.

Repositories: Sorye `D:\projects\sorye`, Rodrigo `D:\projects\rodrigo`. All data goes through Rodrigo; Hub is the editor host, the public renderer and a read cache.

## Read first

Sorye root `AGENTS.md`, `docs/AGENTS.md`, `docs/APP-LANDINGS.md`, `docs/README-STEERING.md`, `docs/I18N.md`, `docs/HUB-RODRIGO-BOUNDARY.md`, `docs/RODRIGO-DATA-CONTRACT.md`, `docs/apps/APPS.md` (sections Site, Messenger, Relay, Drive), `docs/APP-BEHAVIOR-TREE.md`, `docs/SECURITY.md`, `docs/prompts/hub-rodrigo-alignment.md` (the parallel migration), `sandbox/LOCAL.md`.
Current Site code: `packages/types/src/site.ts`, `apps/hub/components/app-site.tsx`, `apps/hub/components/site-public-view.tsx`, `apps/hub/lib/site.ts`, `apps/hub/app/api/site/route.ts`, `apps/hub/app/s/[slug]/page.tsx`, and the Rodrigo site resources and slug index.
Existing app-UI SDK: `packages/sdk` (Lit web components for app chrome). Do not mix site components into it.

## Scope

Presentational websites only: no shop checkout, no user accounts for visitors, no server code written by site owners, no raw HTML or scripts from site owners.

### 1. Component SDK — new package `packages/site-sdk` (`@sorye/site-sdk`)

- React components that **render on the server to static HTML** (`/s/{slug}` must work without client JavaScript). Only the contact form, mobile navigation and a gallery lightbox may hydrate, as small isolated islands.
- Each component is defined by one typed **component definition**: `type`, version, props schema (shared validation used by the CMS form, Hub and Rodrigo), default props, editor field metadata (label, help, field kind), and the renderer. Unknown or invalid props fail validation; renderers never receive unvalidated data.
- Components (initial set): Header/Navigation, Hero, Rich text (safe Markdown subset, no HTML), Features/Services grid, Image + text, Gallery, Team, Testimonials, FAQ, Pricing table (display only), Call to action, Contact form, Collection list, Collection item detail, Logo strip, Footer.
- Theme: design tokens as CSS custom properties (colors, typography scale, spacing, radius); 4–6 presets plus owner overrides; WCAG AA contrast is checked when saving a theme.
- Accessibility: landmarks, heading order, alt text required for images, keyboard-usable navigation, `prefers-reduced-motion` respected.
- Performance budget, measured: no layout shift (images carry width/height), LCP under 2.5 s on the sandbox for a typical page, under 30 KB of JavaScript per page including islands, CSS inlined or one cached file.
- A Storybook-like preview page or docs page listing every component with its props, plus unit tests for validation and rendering.

### 2. CMS — the Site app in Hub

- **Site settings:** name, theme, logo, favicon, default locale and enabled locales, SEO defaults, social image.
- **Pages:** multiple pages with slug, title, navigation placement and order; sections from the SDK, added, reordered, edited and removed; per-page SEO.
- **Content collections:** owner-defined schemas (fields: text, rich text, number, date, boolean, link, image/media reference, select), items with draft/published state, ordering, and use in Collection list/detail components (detail pages at `/s/{slug}/{collection}/{item}`).
- **Media library:** images and documents stored through Rodrigo storage (from the alignment work), size and type limits enforced server-side, SHA-256 integrity, alt text, reuse across pages. Reuse Hub's upload queue and progress UI.
- **Forms and submissions:** form fields built in the Contact form component; submissions stored in Rodrigo; spam protection with a honeypot field, a minimum fill time and per-site plus per-IP rate limits at the Hub edge (no third-party CAPTCHA unless the product owner asks); submission list with read/handled state and CSV export in the CMS.
- **Publishing:** draft and published revisions; preview of the draft; publish is atomic; previous revision can be restored; publishing emits an event that invalidates Hub's page cache.
- **Migration:** existing Site pages (Hero, About, Links, Storefront, Contact blocks) open in the new CMS, converted to the matching components without losing content.

### 3. Internationalization (when the owner enables more than one locale)

- Supported locales follow `docs/I18N.md` (en, de, sk, hu, es; `esp` aliases `es`).
- Every text field, collection field and SEO field can hold per-locale values; missing values fall back to the default locale and the CMS shows which translations are missing.
- Public URLs: `/s/{slug}/{locale}/...`; the bare URL picks the best `Accept-Language` match with a private, non-cacheable temporary redirect; self-canonical URLs, `hreflang` alternates, a per-site sitemap listing every locale.
- The CMS editor UI itself uses Sorye's existing translations.

### 4. Mail sending (through Messenger or the connected Relay)

- When a form is submitted, the owner chooses one or both: post a message to a Messenger channel of the workspace, and/or emit an event that the workspace's connected Relay routes deliver (webhook or connected destination). Do not add an SMTP sender in this round.
- Delivery goes through Rodrigo's durable events (from the alignment work) with retries; the CMS shows delivery status per submission.
- Messages contain the form fields as plain text; never render submitted HTML.

## Ownership and data

- Rodrigo owns: site settings, theme, pages, sections, revisions, collections, items, media metadata and bytes, forms, submissions, slug and locale indexes. Add these as typed resource families in Rodrigo's `contracts/`, with Sorye's snapshot and DTOs in `packages/types/`.
- Hub owns: the CMS screens, the public renderer, a published-page cache invalidated by Rodrigo's publish events, edge limits for public form posts.
- Public reads use the slug index with Hub's reserved service assertion. The workspace for writes always comes from the session.

## Security

- Escape all text; Markdown subset only; links must be `https:` or `mailto:`; images only from the site's own media library; no iframes or third-party embeds in this round.
- Content-Security-Policy for `/s/**` without `unsafe-inline` scripts.
- Size caps on every field, section count, collection size, media size; validated in Rodrigo, not only in the browser.

## Coordination

A parallel session moves every storage and event path into Rodrigo (`docs/prompts/hub-rodrigo-alignment.md`). It owns storage, events, identity and jobs. Build media uploads and form-submission delivery on its storage and event contracts; check the shared notes folder for their status and use additive edits in shared files (Rodrigo `contracts/`, `src/services.rs`, `src/http.rs`, `packages/types/src/index.ts`). If those contracts are not ready when you need them, finish everything else first and ask, do not build a temporary Hub store.

## Ask the product owner first

Custom domains per site, third-party embeds (maps, video), a CAPTCHA provider, SMTP sending, deleting or breaking existing Site content, and any sandbox compose change.

## Deliverables and done

- `packages/site-sdk` with tests; Rodrigo resource families with contract and failure tests; CMS screens; public renderer with i18n, sitemap and cache; form delivery via Messenger and Relay.
- Updated `packages/types/src/apps.ts` (Site entry), `docs/apps/APPS.md`, `docs/APP-BEHAVIOR-TREE.md` and `.html`, the Site landing page in all five locales (`apps/hub/lib/app-landings.ts`, `app-landing-translations.ts`), the admin settings inventory and generated matrix, a README for `packages/site-sdk` following `docs/README-STEERING.md`.
- An end-to-end test: create a two-locale site with two pages, a collection and a contact form, publish, view it logged out, submit the form, see the Messenger message.
- One commit per milestone on its own branch in each repository, not pushed. Verified in the sandbox at `http://localhost:23000` (never `down -v`, never delete volumes, never re-run `sandbox/setup.mjs`).
