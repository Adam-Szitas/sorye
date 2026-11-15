# Agent handoff: SUSM checklist feedback share (public invite)

Implement a **time-limited public feedback flow** for project checklists (todos) in SUSM. An authenticated app-user selects one or more checklists, generates **copyable public URL(s)** (24h), and shares them outside the app (email, chat, etc. — **no in-app mailer**). A visitor opens a URL, enters an **unverified email for attribution only**, updates checklist status and notes for assigned objects, and **submits a pending proposal**. The creating app-user must **accept** before live project data changes. Notify **only the creator**.

Repos (edit both; do not invent Sorye Hub ownership for this feature):

- Frontend: `D:\Martina\app\susm`
- Backend: `D:\Martina\app\susm-be`

Inspect `git status` in both worktrees before editing. Preserve unrelated dirty work. Do not commit unless asked.

---

## Current domain (do not reinvent)

Product UI says **checklist**; code says **todo**.

| Concept | Storage | Key types / files |
|---------|---------|-------------------|
| Checklist template | `company.projects[].todo_items` | FE `src/app/models/todo.model.ts` (`TodoItem`, `TodoSubItem`); BE `src/models/todos/mod.rs` |
| Assignment + live status/note | `company.projects[].objects[].todo_entries` | `ObjectTodoEntry`: `todo_item_id`, `todo_sub_item_id?`, `status` (`under_process` \| `finished` + legacy aliases), `assignment_note?`, `hidden_from_protocol?` |
| Object | Project unit (address/unit), not inventory | FE `object.model.ts`; BE `models/objects/mod.rs` |
| Assign UI | Multi-select checklists → objects | `app-project-todo-modal` → `project-todo-assign-to-checklists-panel` (`selectedChecklistIds`) |
| Per-object UI | Object tab | `object-todos-section`, `todo-item-value-control` |
| APIs today | Auth only | `PUT /project/{id}/todo-items`, `PUT /object/{object_id}/todos`, checklist-note routes |
| Existing public object share | Object UUID token | `GET/POST /public/object/{token}` — **does not expose todos**; reuse patterns (token URL, feature flag `externalSharing`), not the object payload |
| Locale | `User.language` ∈ `en` \| `de` \| `sk` | `TranslationService` + BE `translations/{lang}.json` |
| Notifications today | Toast stack only | `NotificationService` — **not** a persistent inbox |
| Email / mailer | **None** | Do **not** add SMTP, Resend, or any outbound mail for this feature |

Join key: `ObjectTodoEntry.todo_item_id` ↔ `TodoItem._id`. Sub-items: one selected `todo_sub_item_id` per parent when the template has `sub_items`.

---

## Product scenario (accepted decisions)

1. App-user opens a project → opens checklists (`app-project-todo-modal` / assign panel).
2. App-user selects **≥ 1 checklist** (`selectedChecklistIds`).
3. App-user starts **Share for feedback** → creates one or more **share links** (unique URL each). UI shows the full public URL(s) with **Copy** (and optional “add another link” if multiple people should get separate tokens).
4. App-user sends those URLs themselves outside SUSM. **No automatic email sending.**
5. Visitor opens URL → enters **email address** (format-validated only; **not verified**, not matched to a pre-bound invitee). That string is stored so the app-user can see **who claimed** the update. Treat UI copy as “Identify yourself” / “Your email”, not real login/auth.
6. After identify: visitor sees the shared checklists, and under each checklist a sub-list of **objects that have that checklist assigned**, with **current live (accepted) status** and controls to change status and add a note.
7. Visitors **do not** see other people’s notes or pending drafts. They see:
   - current **accepted** status on each object↔checklist row;
   - **notes previously attributed to the same email string** they entered (normalized), after accepts;
   - in the current session, **visual flags** on fields they changed vs the loaded baseline.
8. Edits stay local until **Submit** → creates a **pending submission** (does not mutate `todo_entries` yet).
9. Creator is notified (persistent in-app notification for that account only).
10. Creator reviews and **Accepts** (or rejects/dismisses). Accept applies changes to live `todo_entries` with **last-write-wins** vs concurrent accepts.
11. After **24 hours** from link creation: URL expires; further GET/submit/edit through that token is locked. App-user must generate a new link to continue.

Language of the public page = **locale of the creating app-user** at link creation time (snapshot on the share). Do not use the visitor’s browser language for copy.

### Trust model (intentional)

- The **secret is the URL token**, not the email.
- Email is **informational attribution** only (spoofable). Accept-by-app-user is the real control gate before live data changes.
- Separate URLs still help when the app-user wants distinct channels per person; they are not proof of identity.
- Do not promise “verified login” in UI or docs.

---

## Goals / non-goals

**In scope**

- Auth UI: multi-select → create share link(s) → copy URL; list/manage open links; review/accept pending submissions; creator-only notification surface.
- Public mobile-first feedback site (new route, gated by share token).
- BE: share + pending-submission models, public APIs, accept API, expiry enforcement, i18n keys (en/de/sk).
- Audit: claimed email on each submission; who accepted.

**Out of scope**

- Any outbound email / SMTP / mail provider integration.
- OTP, magic links, or verifying the visitor email.
- Pre-binding invitee emails on the share record (not required).
- Sorye Hub / Rodrigo ownership of this domain.
- Visitors seeing each other’s notes or pending changes.
- Auto-apply on submit without accept.
- Changing checklist templates, object addresses, or `hidden_from_protocol` from the public page.
- Notifying the whole company / other members.

---

## Recommended data model (susm-be)

Store under the company document (or a clearly indexed sub-collection if size warrants — prefer company-scoped documents consistent with existing Mongo nesting, but **do not** blow up hot project payloads: prefer a dedicated collection e.g. `checklist_feedback_shares` keyed by `company_id` + `token` if nested arrays would hurt reads). Choose one approach and document it; prefer query-by-token performance for public routes.

### Share link (`ChecklistFeedbackShare`)

Suggested fields:

- `_id`, `token` (high-entropy, URL-safe, unique)
- `company_id`, `project_id`
- `todo_item_ids: ObjectId[]` — selected checklists at create time (snapshot ids)
- `created_by_user_email` — creator (notification + accept ACL)
- `locale` — snapshot of creator `User.language`
- `created_at`, `expires_at` (= created_at + 24h)
- `status`: `open` \| `expired` \| `revoked`
- Optional label for the creator’s UI only (e.g. “Link for contractor”) — not shown as auth on the public page
- **No** `invited_email` required

**Default object membership:** resolve live assignments at open/submit time among selected checklist ids (newly assigned objects appear; unassigned disappear).

### Pending submission (`ChecklistFeedbackSubmission`)

- `_id`, `share_id`, `token` (same share)
- `submitter_email` — normalized string from the identify step (**unverified**)
- `submitted_at`
- `status`: `pending` \| `accepted` \| `rejected`
- `reviewed_at?`, `reviewed_by_email?`
- `changes[]`: each row identifies `object_id`, `todo_item_id`, and proposed:
  - `status?` / `todo_sub_item_id?` (same validation rules as `update_object_todos`)
  - `note_text?` — **new note contribution** attributed to `submitter_email` (do not overwrite others’ notes)
- `baseline` optional snapshot of values loaded when the public session started (for review UI diffs)

### Attributed notes (live data after accept)

Today `assignment_note` is a single string. Extend the model so visitor notes are attributable and filterable:

- Prefer append-only `assignment_notes: [{ id, author_email?, author_kind: 'member' \| 'visitor', body, created_at }]` **or** keep `assignment_note` for members and add `external_notes[]` for visitors.
- Public view for a session returns: current status/sub-item + **only notes whose `author_email` equals the session email** + current status (not other visitors’ note bodies).
- On accept: append the submitted note under that email; apply status/sub-item with LWW.

Migration: existing `assignment_note` remains readable; backfill as a single member note if you introduce an array.

---

## API sketch (susm-be)

### Authenticated (JWT, company-scoped)

| Method | Path | Behavior |
|--------|------|----------|
| `POST` | `/project/{project_id}/checklist-feedback/shares` | Body: `{ todo_item_ids, count? }` (default `count: 1`, max small e.g. 20). Validate ≥1 checklist. Create share(s), `expires_at = now+24h`, snapshot `locale`. Return `{ id, token, url, expires_at }[]` for copy UI. **No email send.** |
| `GET` | `/project/{project_id}/checklist-feedback/shares` | List shares for project; **default: creator sees own shares + pending counts**. |
| `POST` | `/project/{project_id}/checklist-feedback/shares/{id}/revoke` | Revoke early. |
| `GET` | `/checklist-feedback/submissions?status=pending` | Pending submissions for **current user as `created_by_user_email` only**. |
| `POST` | `/checklist-feedback/submissions/{id}/accept` | Apply LWW to live `todo_entries` + append notes; mark accepted; idempotent if already accepted. |
| `POST` | `/checklist-feedback/submissions/{id}/reject` | Mark rejected; no live mutate. |

### Public (no JWT; token in path)

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/public/checklist-feedback/{token}` | If expired/revoked → 410. Else return locale + enough to render identify gate (project display name optional). Do not leak notes before identify. |
| `POST` | `/public/checklist-feedback/{token}/session` | Body `{ email }`. Validate email **format** only; normalize lowercase/trim. **Do not** check against a pre-bound invitee. Open short-lived public session (signed cookie or opaque session token bound to share+email). Rate-limit. |
| `GET` | `/public/checklist-feedback/{token}/view` | Requires session. Checklists, assigned objects, current statuses, notes for **this session email only**. |
| `POST` | `/public/checklist-feedback/{token}/submit` | Requires session; share open; body = proposed changes. Validate rows belong to share’s checklists and currently assigned objects. Create `pending` submission with `submitter_email` from session. Notify creator. No live mutate. |

Expiry: every public mutating/read-after-session route re-checks `expires_at` and `status`; after expiry lock edits even if the SPA is still open (API returns 410).

Security:

- High-entropy tokens; no sequential ids in URLs. **Token secrecy is the access control.**
- Rate-limit session + submit by IP + token.
- Do not expose company internals, other projects, or unassigned checklist templates beyond the share snapshot.
- Feature-flag if useful (reuse or extend `externalSharing` / new `checklistFeedback` flag).
- CORS and public route registration next to existing `/public/object/{token}`.
- UI + API docs must not describe email as verified authentication.

---

## Frontend (susm)

### In-app (authenticated)

1. **Entry:** From `project-todo-assign-to-checklists-panel` (and/or modal chrome): when `selectedChecklistIds.length >= 1`, show **Share for feedback**.
2. **Share composer:** summary of selected checklists; create 1..N links; show each full URL with **Copy**; optional label; no email recipient fields; no SMTP setup.
3. **Share management:** open/expired/revoked; copy again; revoke; expiry countdown.
4. **Notification surface for creator only:** persistent panel/inbox (extend beyond toasts) listing “checklist feedback received” (include claimed email) with deep link to review. Badge count optional. Do **not** broadcast to other users.
5. **Review UI:** per submission show **claimed** email, checklist/object rows, proposed status/note vs current live baseline, Accept / Reject. On accept, refresh project/object todo state from store.

Reuse status control patterns from `todo-item-value-control` for review display where possible; keep accept as an explicit action.

### Public site

- New route e.g. `/checklist-feedback/:token` (guest guard), mobile-first, large touch targets, simple hierarchy:
  1. Email identify step (format only; clear that it is so the project team knows who responded)
  2. List of checklists → nested objects with status control + note field
  3. Dirty-field indicators for status/note changed in this session
  4. Sticky Submit; success state “waiting for review”
- Locale: activate share `locale` (en/de/sk).
- Expired/revoked empty states with no edit controls.
- Do not show other visitors’ activity.

---

## Apply semantics (accept + LWW)

On accept, for each change row:

1. Load current object `todo_entries`.
2. If checklist no longer assigned → skip or reject row (**default: skip with warning in review UI**).
3. Apply `status` / `todo_sub_item_id` overwriting current values (LWW vs other accepted submissions and member edits).
4. Append visitor note if present under `submitter_email`; never delete other authors’ notes.
5. Persist via the same validation helpers as `update_object_todos` (normalize status aliases, sub-item rules).
6. Mark submission accepted exactly once.

Concurrent pending submissions: accepting A then B means B wins on overlapping fields. Show current live value at review time so the creator sees what will be overwritten.

---

## i18n

Add keys to `susm-be/translations/{en,de,sk}.json` for in-app and public strings. Public page must not fall back to a different language than the share snapshot.

---

## Tests / acceptance

Backend:

- Create shares → unique tokens; return copyable URLs; expiry 24h; revoke.
- Public session: any well-formed email accepted for that token; expired 410; submit creates pending only; `submitter_email` stored as given (normalized).
- Notes filtered by session email string; different email on same token does not see the other’s notes.
- Accept applies status + appends note; second accept idempotent; LWW on overlapping accepts.
- Creator-only listing of pending submissions.
- No mailer modules or send side effects.

Frontend:

- Share CTA disabled with 0 checklists selected; enabled with ≥1.
- Copy URL works; no “send email” flow.
- Public mobile layout usable at ~360px.
- Dirty flags clear after successful submit.
- Review Accept updates object checklist UI without full page reload if store supports it.

Manual E2E path: select checklists → create two links → copy/open each → enter different emails → cannot see each other’s notes → submit → only creator notified → accept → live status/notes updated → after 24h (or forced `expires_at` in test) URL locked.

---

## Implementation order

1. BE models + public/auth routes + expiry + accept/reject; return URL in create response.
2. Public Angular page (email identify, editor, submit).
3. In-app share composer on checklist multi-select + share list + copy.
4. Creator notification panel + review/accept UI.
5. i18n en/de/sk + feature flag + docs/tests.

---

## Understanding check (locked product rules)

- “Checklists” = project `todo_items`; per-object state = `todo_entries` on SUSM **objects** (units).
- Multi-select in `app-project-todo-modal` / assign panel is the entry point.
- App creates **copyable public URL(s)**; app-user distributes them manually — **no mailer**.
- Visitor enters email for **attribution only** (unverified); access control is the **token**.
- 24h expiry locks that URL.
- Privacy: no cross-visitor notes (keyed by claimed email string); show current accepted status; flag local dirty fields.
- Submit → pending; accept required; LWW on accept.
- Notify only `created_by_user_email`.
- Work in `susm` + `susm-be` only for this feature.
