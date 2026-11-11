# Agent handoff: Sorye app expansion roadmap

Extend Sorye from a set of workspace apps into a small-business operations and automation platform. This prompt covers fourteen new apps or capabilities, two cross-cutting capabilities (bring-your-own drive, public visitor tools) and the order to build them. Implement **one app per change set**. Do not start the next app until the previous one passes its acceptance checks.

## Repository context and working rules

- Sorye repository: `D:\projects\sorye`. Rodrigo backend: independent repository `D:\projects\rodrigo`. Inspect both worktrees with `git status` before editing and preserve existing uncommitted work.
- Read first: root `AGENTS.md`, `docs/AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/HUB-RODRIGO-BOUNDARY.md`, `docs/RODRIGO-DATA-CONTRACT.md`, `docs/RODRIGO-DATABASE-SWITCHING-RUNBOOK.md`, `docs/apps/APPS.md`, `docs/APP-LANDINGS.md`, `docs/README-STEERING.md`, `docs/I18N.md`, both `docs/APP-BEHAVIOR-TREE` files, and Rodrigo's `AGENTS.md`, `docs/CONTRACTS.md`, `docs/OWNERSHIP.md`.
- Performance, reliability, security and modularity outrank feature breadth. Measure claims about concurrency, load and failure; do not assert them.
- No production deployment, image promotion, credential rotation, destructive migration or live database change. Validate against disposable infrastructure. Never print credentials.
- If a requested feature would weaken security, data ownership or modularity, stop, explain the concrete risk and propose a safer design before implementing.

## Architecture rules every new app must follow

```text
Browser app (MF remote or Hub-native page)
   -> Hub /api/*            session, workspace from server session, app access, validation
   -> Rodrigo v2 contract   signed actions/reads, typed resources, receipts, revisions
   -> PostgreSQL / S3       owned by Rodrigo
```

1. **Catalog.** Add an `AppCatalogEntry` in `packages/types/src/apps.ts` (id, slug, category, `usageIntro`, `costWeight`, plan gating). Keep `docs/apps/APPS.md`, `apps/hub/lib/mf-remotes.ts`, the root dev filter and the Catalog consistent.
2. **Frontend kind.** Interactive apps are Vite Module Federation remotes exposing `./mount` (copy the structure of `apps/tasks`, the reference app). Use a Hub-native page only when the app needs Hub-only capabilities and say why.
3. **Durable data goes through Rodrigo v2.** Add new resource families to Rodrigo's authoritative `contracts/` (OpenAPI + TypeScript) and its typed resource validation first; then update Sorye's reviewed snapshot/DTOs in `packages/types/`, `apps/hub/lib/rodrigo/action-validation.ts`, and app/role gates. Browser writes use a scoped IndexedDB `createDurableActionQueue`, `POST /api/backend/actions/batch`, `create` without `expectedRevision`, update/delete with it. Never add a Hub JSON/Postgres writer for a new domain, never dual-write, never fall back silently.
4. **Workspace scope.** Derive user and workspace from `ensureHubUser()`. Never accept a workspace id from the browser. Personal/Work lists use `partitionUserLoad`.
5. **No app-to-app calls.** Cross-app behaviour uses allowlisted workspace events (`packages/types/src/events.ts`, `apps/hub/lib/events.ts`), Relay, handoffs (`/api/handoffs`) and notifications. Add each new event name to the allowlist with a typed payload and size limit.
6. **Private UI state** stays in the app (`createAppStore`). Do not add global kernel signals for app data.
7. **i18n.** Every visible string, placeholder, `aria-label` and error message goes through `t()` with a namespace file in `packages/platform/src/messages/<app>.ts` defined with `defineMessages` (all five locales: en, de, sk, hu, es; placeholders identical). Format dates, numbers and money with `Intl` using the selected locale. Never translate user data.
8. **Embeddable by default.** MF remotes must render correctly inside `/embed/[slug]` (no Hub chrome, narrow widths, no reliance on `window.top`).
9. **Mobile first.** Design for 360 px first, then tablet and desktop. 16 px inputs, 40 px touch targets, keyboard and screen-reader support, visible focus, `prefers-reduced-motion`.
10. **Plans.** Gate features in `packages/types/src/subscription.ts` (see pricing in this prompt). Enforce limits on the server, not only in the UI.
11. **Docs in the same change.** `docs/apps/APPS.md`, both behaviour-tree files, a complete landing page under the app-landing system in all five languages (`docs/APP-LANDINGS.md`), and README steering where a README is added.
12. **Telemetry.** Bounded, payload-free metrics and logs. No personal data or document contents in logs.

## Shared building blocks to create once and reuse

Build these as part of the first app that needs them, behind explicit contracts:

- **Money & tax types** (`packages/types/src/money.ts`): integer minor units, ISO 4217 currency, VAT rate per line, rounding rules, locale formatting. Never use floats for money.
- **Numbering service**: gap-free, per-workspace, per-series numbers (invoices need legally sequential numbers). Implemented in Rodrigo with a transactional counter, not in the browser.
- **Contact reference**: a stable `contactId` other apps store; CRM owns the record.
- **PDF rendering**: reuse the Protocolio renderer through the Hub bridge; templates are data, not code.
- **Public endpoints**: anonymous submission/booking routes with rate limiting, payload size limits, honeypot + optional CAPTCHA, and a reserved Rodrigo grant (pattern: published Site reads).
- **Scheduler**: durable delayed/recurring jobs. Rodrigo does not have durable jobs yet; design the contract (idempotency key, retries with backoff, dead-letter, at-least-once) before any feature depends on it. Until then, features needing schedules ship without them or behind a flag.

## Build order

| Phase | Item | Why first |
|---|---|---|
| 1 | Forms (implemented, see status below) | Small, reuses events/Relay, immediate value, feeds CRM/Tasks |
| 1 | Invoicing & Quotes | Highest willingness to pay; reuses Protocolio, Mail, Storefront |
| 2 | CRM / Contacts | Ties every other app to a customer |
| 2 | Bring-your-own drive | Requested; unlocks Team plan value |
| 3 | Flows (automation builder) | Platform differentiator; needs the scheduler contract |
| 3 | Booking / Appointments | Public traffic; writes to Calendar |
| 3 | Time tracking | Feeds Invoicing |
| 4 | Approvals, Document AI inbox, AI assistant | Build on Flows, OCR, Mail |
| 4 | Free public tools | Acquisition; reuse existing renderers |
| 5 | Inventory, Expenses, HR basics, Wiki, Helpdesk | After the core is stable |

---

## Status

| Item | State | Notes |
|---|---|---|
| Forms | Implemented as a Hub-native app | Rodrigo contract and PostgreSQL test pass. Deferred from the MVP list: file uploads, notification recipients and the `sorye.forms.submitted` event (Hub does not learn the owning workspace), submission limit, close date, CAPTCHA, CSV-safe export only, Site block, per-plan limits, Playwright journey. |
| Everything else | Not started | |

## 1. Forms

**Purpose.** Build forms (contact, order, application, feedback, survey) and collect submissions from Site pages, embeds or a public link.

**MVP features**
- Builder with fields: short text, long text, email, phone, number, date, single/multi choice, dropdown, checkbox, file upload (to Drive, size-capped), consent checkbox, hidden field, section heading. Required/optional, help text, min/max, regex pattern.
- Live preview at phone and desktop widths. Duplicate, reorder, delete fields.
- Publish toggle; public URL `/f/<slug>`; embed via `embed.js` and a Site block.
- Submissions table: filter, search, view detail, mark handled, export CSV.
- Settings: success message or redirect URL, notification recipients (workspace members), submission limit, close date, spam protection.
- Conditional logic (show field when another has value) — phase 2.

**Data (Rodrigo resource types)** `forms/form` (definition, version, published flag, slug), `forms/submission` (formId, formVersion, answers, submittedAt, source, status). Submissions are append-only; edits create a status change, never rewrite answers. Slug index reserved in the same transaction (pattern: Site).

**Events** `sorye.forms.submitted` `{formId, submissionId, title}` (no answers in the event payload).

**Integrations** Flows/Relay can turn a submission into a Task, CRM lead or Messenger post. Site gets a "Form" block.

**Security** Public submit endpoint: rate limit per IP and per form, 64 KiB body cap, field-type validation on the server against the stored definition version, honeypot, optional CAPTCHA, no HTML rendering of answers (escape everywhere), file uploads virus/size/type checked. GDPR: consent field, retention setting per form, delete-submission action.

**Plan** Free: 1 form, 100 submissions/month. Solo: 5 forms. Team and above: unlimited forms; submissions quota scales with plan.

**Acceptance** Create → publish → submit anonymously from a third-party page → submission appears, notification fires, event emitted; unpublish returns 404; invalid/oversized/spam submissions rejected; all strings translated.

---

## 2. Invoicing & Quotes

**Purpose.** Create quotes, convert to invoices, send as PDF, record payments, see what is overdue.

**MVP features**
- Company profile: legal name, address, company ID / tax ID / VAT ID, bank account (IBAN/BIC), logo, default currency, default payment terms, invoice number series.
- Documents: quote, invoice, credit note (corrective), proforma. Lines: description, quantity, unit, unit price, discount, VAT rate; totals per VAT rate; rounding.
- Quote → invoice conversion keeps a link. Credit note references the original invoice.
- Status: draft, issued, sent, partially paid, paid, overdue, cancelled. Issued invoices are immutable; corrections only via credit note.
- Gap-free numbering per series and year (shared Numbering service).
- PDF via Protocolio template with QR payment code (EPC/SEPA QR; Slovak "PAY by square" as an option).
- Send via Mail (workspace mailbox or connected account) with PDF attached; log the send.
- Record payments manually; overdue list; reminder email (phase 2, needs scheduler).
- Export CSV / accounting export; ISDOC or UBL XML export (phase 2).
- Multi-currency with the exchange rate stored on the document.

**Regional compliance (research and confirm before shipping; do not guess legal rules)**
- Slovakia/EU: mandatory invoice fields, VAT rules, reverse charge text, e-invoicing obligations and their dates.
- Hungary: NAV Online Számla real-time reporting is mandatory for domestic invoices — design an adapter interface; implement only after confirming the current API.
- Germany: XRechnung / ZUGFeRD for B2B e-invoicing.
- Spain: Verifactu requirements.
Record sources and dates for each rule in `docs/apps/INVOICING-COMPLIANCE.md`.

**Data** `invoicing/profile`, `invoicing/document` (type, number, series, status, customer snapshot, lines, totals, currency, dates, links), `invoicing/payment`, `invoicing/series` (counter in Rodrigo). Store a customer **snapshot** on the document so later CRM edits do not change issued invoices.

**Events** `sorye.invoice.issued`, `sorye.invoice.paid`, `sorye.invoice.overdue`, `sorye.quote.accepted`.

**Integrations** CRM contact picker; Storefront enquiry → quote; Time tracking → invoice lines; Document AI inbox → incoming (supplier) invoices later.

**Plan** Free: 3 invoices/month with Sorye footer. Solo: unlimited, 1 series. Team+: multiple series, reminders, exports.

**Acceptance** Totals match a reference spreadsheet for multiple VAT rates and discounts (property tests on rounding); numbering has no gaps or duplicates under 50 concurrent issues; issued invoice cannot be edited; PDF renders in all five languages; credit note links correctly.

---

## 3. CRM / Contacts

**Purpose.** One record per customer, lead and supplier, with everything that happened with them in one timeline.

**MVP features**
- Companies and people (person can belong to a company). Fields: name, emails, phones, address, tax IDs, tags, owner, custom fields (text, number, date, choice).
- Deal pipeline: configurable stages, value, expected close date, probability; Kanban and list views.
- Timeline per contact: notes, calls/meetings logged manually, plus linked items from other apps (invoices, form submissions, Storefront enquiries, mail threads, tasks) read through Hub, not copied.
- Search, filters, saved views, CSV import with column mapping and duplicate detection, CSV export.
- Contact picker component exported through `@sorye/platform` so other apps reference `contactId` without importing CRM.

**Data** `crm/contact`, `crm/company`, `crm/deal`, `crm/activity`, `crm/pipeline`. Cross-app links are stored as references `{appId, resourceType, resourceId}` on the activity, authorized on read.

**Events** `sorye.crm.contact_created`, `sorye.crm.deal_stage_changed`, `sorye.crm.deal_won`, `sorye.crm.deal_lost`.

**Privacy** Export and erase a person's data (GDPR access/erasure) across linked apps; record lawful basis and consent where collected via Forms.

**Plan** Free: 100 contacts. Solo: 2,000. Team+: unlimited, pipelines, custom fields.

**Acceptance** Import 5,000 rows with duplicates in under the agreed time; timeline shows linked invoice and form submission; erasure removes or anonymizes the person everywhere it is referenced.

---

## 4. Bring-your-own drive (cross-cutting)

**Purpose.** A workspace can use its own storage instead of Sorye's Drive storage.

**Scope**
- Providers in order: S3-compatible (AWS S3, Cloudflare R2, MinIO, Wasabi — reuse Relay's encrypted storage connections), then Google Drive, Microsoft OneDrive/SharePoint, Dropbox via OAuth.
- Workspace setting: "Drive storage: Sorye / connected provider". Changing it does not move existing files automatically; offer an explicit, resumable, verified copy job.
- Drive UI unchanged; a provider adapter interface behind Hub (`list`, `get`, `put`, `delete`, `rename`, `move`, quota), streaming, size limits, server-derived object keys.
- OAuth tokens and keys encrypted at rest (existing `STORAGE_SECRET_KEY` pattern), scoped to the minimum provider permission (app folder only where the provider supports it), refresh handled server-side, revocation on disconnect.
- Clear errors when the provider is down, quota is full or access was revoked; no silent fallback to Sorye storage.

**Plan** Team and above.

**Acceptance** Upload/download/rename/delete through each provider; token expiry and revocation handled; a provider outage shows an explicit error and does not affect other workspaces; no credential ever reaches the browser.

---

## 5. Flows (automation builder)

**Purpose.** "When something happens, do something" across apps, without code.

**MVP features**
- Triggers: any allowlisted workspace event; schedule (cron-like, after scheduler contract exists); incoming webhook (secret URL); form submission; manual run.
- Steps: create task, create note, post to Messenger channel, send email, create CRM contact/activity, create invoice draft, HTTP request (SSRF-protected, allowlisted methods, timeouts), delay, condition (if/else on fields), set variable.
- Field mapping from trigger payload to step inputs with a typed picker and preview.
- Run history with per-step status, duration and error; retry a failed run; disable a flow.
- Templates gallery ("Form submission → task + Messenger", "Invoice overdue → email reminder", "New deal won → create project tasks").

**Execution model** Runs execute server-side (Rodrigo durable jobs once available; until then Hub worker with persisted `background_jobs`, the pattern Relay webhooks use). Each step is idempotent with a step key; at-least-once delivery with deduplication; bounded retries with backoff; per-workspace concurrency and monthly run quotas; loop protection (a flow cannot trigger itself more than N levels deep).

**Security** Steps act with the flow owner's permissions, re-checked at run time; disabled when the owner loses access. Secrets stored encrypted and never returned to the browser.

**Plan** Free: 1 flow, 100 runs/month. Solo: 5 flows, 1,000 runs. Team: 25 flows, 10,000 runs. Business: unlimited flows, 100,000 runs.

**Acceptance** Kill the worker mid-run: the run resumes without duplicating side effects; a webhook storm is rate-limited; quota exhaustion pauses runs with a visible message.

---

## 6. Booking / Appointments

**Purpose.** Public booking page that fills the Calendar.

**MVP features** Services (name, duration, buffer, price optional), weekly availability, date exceptions, minimum notice, maximum horizon, staff members, time-zone aware slots, public page `/b/<slug>`, embed widget, confirmation email with `.ics`, cancel/reschedule link with signed token, reminder emails (needs scheduler), double-booking prevention by a transactional slot reservation in Rodrigo.

**Events** `sorye.booking.created`, `sorye.booking.cancelled`.

**Integrations** Calendar event created per booking; CRM contact matched or created; optional deposit later via payments.

**Acceptance** Two visitors booking the same slot at the same time: exactly one succeeds; DST transitions produce correct slots; cancel link cannot be reused or guessed.

---

## 7. Time tracking & Timesheets

**Purpose.** Track time on tasks/projects/customers and bill it.

**MVP features** Start/stop timer (one running per user, survives reload), manual entries, link to task / CRM company, billable flag and rate, weekly timesheet view, approval by a manager (optional), reports by person/customer/project, export CSV, "Create invoice from unbilled time".

**Data** `time/entry`, `time/rate`. Entries are workspace-scoped; members see their own unless granted.

**Acceptance** Timer survives tab close and device switch; overlapping entries flagged; invoice lines equal billed hours × rate.

---

## 8. Approvals

**Purpose.** Requests that need someone's yes: expenses, leave, purchases, discounts, documents.

**MVP features** Request types with configurable fields (reuse the Forms field engine), approval chain (single, sequential, any-of), approve/reject with comment, attachments, delegation while away, status visible to requester, notifications and Messenger posts, audit trail (immutable decision history).

**Events** `sorye.approval.requested`, `sorye.approval.decided`. Flows can trigger on decisions.

**Acceptance** A decision cannot be changed after the fact; an approver removed from the workspace can no longer decide; concurrent approve/reject resolves deterministically with a revision conflict.

---

## 9. Document AI inbox

**Purpose.** Forward supplier invoices, receipts and documents to a workspace address; they are read and filed automatically.

**MVP features** Inbound address per workspace (`inbox+<token>@…` via the Mail pipeline), PDF/image attachments sent to OCR, extraction to a typed draft (supplier, date, number, totals, VAT lines, IBAN) using the existing OCR + configured AI model, confidence per field, human review screen, then "file as expense" / "create supplier invoice" / "save to Drive". Duplicate detection by supplier + number + amount.

**Security** Only accept mail from verified senders configured by the workspace or require review for unknown senders; size and type limits; malware scanning; extracted data never auto-posts payments.

**Plan** Counts against the OCR page quota.

**Acceptance** Sample set of real-format invoices (synthetic data) reaches the agreed field accuracy; low-confidence fields are highlighted; nothing is filed without review in MVP.

---

## 10. AI assistant

**Purpose.** Ask questions and run safe actions across workspace data: "What is overdue this week?", "Summarize this customer", "Draft a reply to this enquiry".

**Design**
- Use the admin-console shared AI configuration (Rodrigo `shared-ai` namespace) for provider/model; respect workspace opt-in.
- Tool-calling over Hub APIs with the user's own permissions; read tools first; write tools always require an explicit confirmation step in the UI (pattern: existing MCP tools with `requiresConfirmation`).
- Retrieval only over data the user can already read; citations linking to the source item.
- No training on customer data; prompts and outputs not logged beyond bounded, redacted telemetry; per-workspace monthly token quota.

**Acceptance** The assistant cannot read another workspace's data even when asked; every write action shows a confirmation; quota exhaustion is explained.

---

## 11. Free public tools (acquisition)

**Purpose.** Useful tools that work without an account, rank in search and convert visitors.

**Tools** PDF merge / split / compress / PDF-to-CSV (OCR), invoice generator (no account; download PDF), quote generator, QR code generator (URL, vCard, Wi-Fi, EPC payment), VAT/margin calculator, email-signature builder, simple booking link.

**Rules**
- Process files in the browser where possible (WebAssembly/PDF libraries) so files never leave the device; where the server is required, delete inputs immediately after processing and say so.
- Strict limits (file size, pages, requests per IP), no tracking cookies without consent.
- Each tool has its own localized landing URL in all five languages, structured data, fast LCP on mobile, and one clear "Save this to Sorye" call to action that carries the result into a new account (handoff after signup).

**Acceptance** Lighthouse mobile performance and accessibility targets met; tools work offline-first where browser-only; no file persists on the server.

---

## 12. Later apps (spec briefly, build after phases 1–4)

- **Inventory / Stock:** items, SKUs, locations, stock movements (in/out/transfer/adjust) as an append-only ledger, low-stock alerts, Storefront and Invoicing decrement stock on order/invoice.
- **Expenses:** receipts via Document AI inbox or upload, categories, VAT, reimbursement through Approvals, export to accounting.
- **HR basics:** employee records (sensitive data: strict role access, field-level visibility), leave balances and requests via Approvals, onboarding checklists via Tasks templates, team calendar.
- **Wiki / Knowledge base:** Notes grown into nested pages with links, permissions per space, version history, optional public help center published through Site.
- **Helpdesk:** shared inbox from Mail and Forms, tickets with status/assignee/priority, canned replies, SLA timers (scheduler), customer portal page, CSAT survey via Forms.

For each, write a full section in the same format (purpose, MVP, data, events, integrations, security, plan, acceptance) before implementation and get it reviewed.

---

## Pricing and plan gating to implement

Prices excl. VAT; annual = 10 × monthly. Update `packages/types/src/subscription.ts` and enforce on the server.

| Plan | Price | Members | Key limits |
|---|---|---|---|
| Free | €0 | 1 | 3 apps, 1 GB, 1 form, 3 invoices/mo, 1 flow / 100 runs, 20 OCR pages |
| Solo | €9/mo | 1 | All core apps, 20 GB, 5 forms, 5 flows / 1,000 runs, 200 OCR pages, 1 embed widget |
| Team | €29/mo, +€5/extra member | 5 incl. (max 25) | BYO drive, 100 GB, 25 flows / 10,000 runs, 1,000 OCR pages, 5 widgets |
| Business | €79/mo, +€4/extra member | 15 incl. | 5 team workspaces, 500 GB, unlimited flows / 100,000 runs, 5,000 OCR pages, audit |
| Enterprise | from €300/mo | custom | Dedicated stack, own database, SLA |

Add-ons: OCR €10 / 1,000 pages; storage €3 / 50 GB; extra team workspace €10/mo. Quotas must be counted durably (Rodrigo), shown in the UI before the limit is hit, and fail with a clear upgrade message rather than data loss.

## Definition of done for every app

- Catalog, MF remote or Hub-native page, Rodrigo contract + resource validation, Hub gateway validation, scoped IndexedDB queue, events allowlist.
- All five translations; `Intl` formatting; mobile-first layout checked at 360 px, 768 px and 1280 px.
- Works inside `/embed/[slug]` where it is an MF remote.
- Tests: unit (domain rules, money/rounding), Rodrigo contract tests with the real TypeScript signer, concurrency/conflict tests, an outage test (Rodrigo down → explicit error, queued writes, no fallback), Playwright journey in `e2e/`.
- `docs/apps/APPS.md`, both behaviour-tree files, landing page (all languages), and this roadmap's status table updated.
- Security review notes: auth boundary, public endpoints, rate limits, data retention, GDPR export/erase.
- Report: what changed, what was verified (with command output), what remains unverified.
