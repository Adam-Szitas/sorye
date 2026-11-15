# Prompt: Secure public links for Drive files and folders

Implement secure, revocable public sharing for Sorye Drive. An authorized workspace member can generate a link to one file or folder and grant either **read-only** or **read and write** access. A person with the link can use the resource without creating a Sorye account, subject to the link's controls. Treat the URL as a bearer credential: anyone who obtains it can act with its configured permission.

## 1. Inspect the current system first

Read Sorye `AGENTS.md`, `docs/AGENTS.md`, `docs/SECURITY.md`, `docs/HUB-RODRIGO-BOUNDARY.md`, `docs/RODRIGO-DATA-CONTRACT.md`, `docs/DRIVE-FOLDERS.md`, both behavior trees, `docs/apps/APPS.md`, and the app landing-page guidance. Read Rodrigo `AGENTS.md`, its authoritative `contracts/rodrigo.openapi.json`, storage/file/folder handlers, and migrations. Inspect `git status` in both repositories and preserve all existing work.

Trace Drive's current end-to-end ownership: Hub session and workspace authorization, signed Hub-to-Rodrigo calls, PostgreSQL metadata/folder paths, and actual object providers. Identify default S3, configured own-storage targets, and separately connected Relay buckets. Establish which destinations can support public link reads/writes without making private credentials public or bypassing Hub policy. Do not assume all targets have the same capabilities.

## 2. Define and document the product contract

Before implementing, make concrete decisions in a short design note:

- Link permissions are exactly `read` and `read_write`; read access must never mutate content or metadata.
- Link targets are one file or one folder subtree. A folder link must not reveal sibling folders or resources outside that subtree.
- Clarify whether write access allows only uploading/creating children, or also replacing, renaming, moving and deleting existing content. Choose the narrowest useful policy; show the recipient exactly what operations are allowed. Do not imply delete/update access if it is not implemented.
- Define who may create, inspect, change permission on, revoke, and delete a link. Derive workspace and actor from the authenticated Hub session, never a request body.
- Decide how links behave when an owner loses workspace access, a file is deleted, a folder is removed, the storage target changes, or a connected bucket is disconnected/unavailable.
- Specify how duplicate names are handled, whether empty folders are visible, and how upload quotas/type restrictions apply to public writes.
- Decide whether access is anonymous or optionally password-protected. Do not add password protection unless storage, hashing, throttling, and recovery behavior are designed safely.
- Define link lifetime: default expiry, maximum expiry, renewable expiry, and whether a non-expiring option is permitted. Prefer bounded expiry and make it visible to the creator and recipient.

Do not expose a share until its target, access mode, expiry, and recipient experience have precise behavior in the contract and UI.

## 3. Security and privacy requirements

- Generate at least 256 bits of cryptographically secure random token material. Store only a one-way hash of the token in Rodrigo; show the complete URL only at creation and never recover it later.
- Keep token-bearing URLs out of analytics, request logs, traces, referrers, error text, browser history where practical, and external resource requests. Apply `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, and safe content headers on share pages and APIs.
- Tokens must be unguessable, scoped to one resource and workspace, permission-limited, expiring, revocable, and checked on every operation. Use constant-time token-hash comparison where relevant, rate-limit attempts, and return non-enumerating errors for invalid, expired, or revoked links.
- Do not put workspace IDs, storage credentials, object keys, internal file IDs, signed Rodrigo assertions, or provider URLs in the public link. Use an opaque token to resolve authority on the server.
- Bind all actions to the exact shared root. Prevent `..`, prefix confusion, encoded-slash tricks, symlink/path escape, IDOR, cross-workspace access, file replacement, and folder traversal. For folder links, enforce containment on every descendant read/write in Rodrigo and Hub, not only in UI filtering.
- Public write links must use bounded request bodies, rate and concurrency limits, quotas, upload slots, deadlines, and the existing executable/signature/type policy. Preserve Tasks/OCR-specific restrictions when the source app requires them. Never execute uploaded files.
- Serve unsafe formats only as downloads with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. Do not render uploaded HTML/SVG/scripts inline on the Sorye origin.
- Apply CSRF/origin defenses to mutations. A bearer token is the sole recipient credential; a public page must not mint workspace sessions or elevate permissions.
- Add privacy-conscious audit records for creation, permission/expiry changes, revocation, and bounded access events. Never log the bearer token, resource contents, or high-cardinality user/resource labels as metrics.
- If a storage target cannot safely enforce the requested operation, refuse that operation explicitly; never silently switch destinations or fall back to Sorye storage.

## 4. Contract and persistence

- Rodrigo owns durable share records and enforcement. Extend Rodrigo's authoritative OpenAPI contract, typed DTOs, scoped handlers, adapter/transaction boundaries and additive database migrations. Update Sorye's reviewed contract snapshot and Hub DTO/client code in the same change.
- Workspace identity and share-owner identity come from the signed Hub assertion. Public requests use a dedicated narrow public-share assertion or another reviewed server-to-server mechanism; do not weaken existing identity grants or allow anonymous callers to submit arbitrary workspace/resource IDs.
- Define create/list/update/revoke APIs for authenticated owners and resolve/read/mutate APIs for bearer-link recipients. Keep permission checks in Rodrigo at the final data boundary, including object fetch/import operations.
- Store only token hash, opaque share ID, workspace/root resource, permission, creator, timestamps, expiry/revocation state, and minimal audit metadata. Add indexes, bounded result limits, uniqueness/idempotency behavior, and concurrency-safe revocation/permission changes.
- Ensure revocation takes effect immediately or define and measure a short, explicit maximum cache delay. Do not let cached authorization outlive revocation beyond the stated bound.
- Existing files and folders remain private by default. Migration creates no implicit/public links. Existing file object keys and Drive folder ownership do not change.
- Decide how cloud-connected buckets are handled. Public requests must not receive customer credentials. Prefer Rodrigo proxying each authorized operation after enforcing the share grant. Explicitly refuse sharing through a provider if containment, quota, or revocation cannot be guaranteed.

## 5. Hub APIs and user experience

- Add authenticated Drive controls to create a link, choose file/folder, set read or read/write, set expiry, copy the URL, view active links, change allowed settings, and revoke. Use an accessible dialog/form with clear validation, keyboard behavior, loading/error states, and confirmation for irreversible revocation.
- Display each link's permission, target, creation/expiry dates, and status. Show the full token only once; later views reveal a safe short identifier, never the secret.
- Add a public share route and minimal recipient interface. Explain who shared the resource when that information is safe, whether the visitor can read or write, and any limits/expiry. For write links expose only the operations chosen in the design; keep navigation inside the shared root.
- Make anonymous viewers receive a clean unavailable response for invalid/expired/revoked links without disclosing whether another workspace resource exists.
- Keep the main Drive app within Hub shell conventions. Do not add a second navbar or direct app-to-app calls.

## 6. Verification requirements

Use disposable identities and isolated test providers. Do not run destructive checks against production or the user's real connected buckets.

Test at minimum:

1. Owner creates a read link to a file and folder; recipient reads the target and sees only the permitted subtree.
2. Read-only link cannot upload, replace, rename, delete, create folders, or access sibling resources by API manipulation.
3. Read/write link can perform only the specified operations and continues to obey file type, size, byte-count, file-count and storage quotas.
4. Cross-workspace and cross-folder IDs, tampered paths, encoded traversal, token guessing, expired/revoked links, wrong HTTP methods, CSRF attempts, and malformed/oversized bodies fail closed.
5. Link creation/retry is idempotent where defined; two concurrent permission updates/revocations have deterministic results; revoked grants cannot be revived by stale cache or retry.
6. Owner loses membership, target is deleted, storage becomes unavailable, or provider is disconnected: verify the documented failure behavior and no silent fallback.
7. Restart Hub and Rodrigo and verify link records persist while plaintext tokens remain unrecoverable. Verify expiry/revocation using database time or a controlled test clock.
8. Check browser privacy headers, referrer behavior, cache headers, download disposition, and that tokens/credentials are absent from logs and metrics.
9. Measure public-link read/write latency and bounded concurrency. Include performance and failure observations, not framework-based assurances.
10. Check keyboard and narrow/wide layouts for link management and recipient pages.

Run applicable Hub typecheck and focused tests, Rodrigo formatting/Clippy/tests, signed contract tests, disposable PostgreSQL/object-provider integration tests, and sandbox browser checks. Record skipped tests with the exact missing safe dependency. Do not call the feature complete based on UI or a route returning 200.

## 7. Documentation and completion

Update both `docs/APP-BEHAVIOR-TREE.md` and `.html` for the new public route, authorization boundary, state owner and persistence behavior. Update `docs/DRIVE-FOLDERS.md`, `docs/SECURITY.md`, `docs/RODRIGO-DATA-CONTRACT.md`, `docs/HUB-RODRIGO-ALIGNMENT.md`, app reference, and all five Drive landing translations with truthful scope/limitations. Update `docs/BUG-FINDER.md` if it tracks related gaps. Keep Rodrigo's contract authoritative and Sorye's snapshot byte-compatible as required by existing tests. Add no credentials or bearer URLs to documentation.

Completion report must state the exact permission semantics, expiry/revocation behavior, storage targets supported, verified routes and tests, performance observations, and remaining limitations. If a design decision is unresolved, list it before implementation; do not silently guess product policy.
