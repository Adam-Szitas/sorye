# Prompt: Verify Sorye Hub ↔ Rodrigo app connections

Act as an integration-test engineer working in the Sorye monorepo and its sibling Rodrigo repository. Verify that every currently implemented Hub-to-Rodrigo connection works through the real authenticated Hub gateway and Rodrigo contract. Produce reproducible evidence; do not infer success from a running container, green readiness probe, route declaration, or mocked adapter.

## Authority and guardrails

Read Sorye `AGENTS.md`, `docs/AGENTS.md`, `docs/SECURITY.md`, `docs/HUB-RODRIGO-BOUNDARY.md`, `docs/RODRIGO-DATA-CONTRACT.md`, `docs/HUB-RODRIGO-ALIGNMENT.md`, and Rodrigo `AGENTS.md` before testing. Preserve all dirty work. Treat Rodrigo `contracts/rodrigo.openapi.json` as authoritative and Sorye's `packages/types/contracts/rodrigo.openapi.json` as the reviewed snapshot. Keep browser calls same-origin through Hub; never give the browser a Rodrigo token or assertion. Never print secrets, session cookies, payloads, or user identifiers. Use disposable test identities/data and explicitly configured test databases/buckets only; abort a destructive test if ownership of its target cannot be established. Do not erase sandbox volumes.

Report current behavior separately from future/advertised contracts. The data contract and alignment matrix identify what is implemented versus uncovered. Do not probe production by default. Do not label future features as tested.

## Connection inventory

Build a table from actual Hub API call sites and Rodrigo clients, not from the app catalog alone. At minimum classify Identity/session and workspace resolution; v2 action-backed apps (Tasks, Notes, Calendar, Canvas, Site/CMS, Storefront, Forms, Messenger); Drive files/folders, quota, own-storage and Relay cloud storage; public Site reads/forms; service capabilities/tokens/change stream; remaining Hub-owned APIs; and any app/worker connection that directly uses Rodrigo. For each include app, browser-facing Hub route, signed Rodrigo route and scope, contract/DTO, durable owner, current test coverage, and whether the connection is implemented, partial, or planned. Exclude advertised endpoints with no live caller from the implemented list.

## Test layers

1. **Static contract consistency:** compare OpenAPI source and reviewed snapshot; verify Hub Zod/request DTOs and route paths/scopes match Rodrigo handlers. Check unknown-field rejection, response bounds, migration ordering, capability reporting, and that each live call site has at least one focused test. Record contract-only operations without claiming they are app-connected.
2. **Unit and route tests:** run relevant Sorye and Rust checks. Cover valid/invalid request shapes, scope and app enablement, same-origin session behavior, status/error mapping, limits, and client-side stale workspace guards. Do not mock away the signature verifier or persistence behavior in tests described as integration tests.
3. **Signed HTTP integration:** run the real Rodrigo binary against isolated PostgreSQL and S3-compatible test providers using generated test-only Ed25519 keys and the production Hub signer/client. Verify method/path/body-digest/audience/key-id/expiry binding, missing or tampered signature rejection, scope denial, replay/idempotency behavior, adapter outage fail-closed behavior, and useful request IDs without sensitive logs.
4. **Data and authorization:** for every migrated family create/read/update/delete where supported; verify durable state after Rodrigo restart, workspace isolation, actor ownership, conflicting revisions, duplicate actions, and provider errors. For file/blob paths compare uploaded/downloaded checksums and preserve folder hierarchy. Never assume one provider transactionally commits another provider's side effect.
5. **Live sandbox:** preserve volumes, verify database and object-store readiness, inspect the deployed Hub/Rodrigo versions, then exercise browser → Hub → signed Rodrigo on port 23000 with a disposable member/session. Test one real representative flow per supported family and all security-critical edges. Verify DB writes and restart persistence. Record skipped paths when no test user, selected app, connected cloud target, model, or safe browser session is available.
6. **Failure and performance:** inject unavailable DB/S3, timeouts, malformed/truncated responses, 429/503, signature failures, stale workspace changes and concurrent same-resource writes. Verify no false success, no silent fallback, bounded retries/body/concurrency, queue retention/recovery, and useful user-facing errors. Measure endpoint latency and upload throughput/memory for claims; report environment and sample size. Keep telemetry labels bounded and free of user/workspace/resource IDs.

## Execution procedure

- Inspect both `git status` outputs and existing test scripts before running anything. Select only safe disposable test providers. Do not reuse or expose credentials.
- Run format, lint, typecheck, focused unit/contract tests, real signed integration suites, then sandbox browser checks. Run broader suites only when focused checks expose shared regressions or the repository requires them.
- Use Browser Bridge only on the user's local sandbox tab when available; otherwise use the repo's supported Playwright setup. Do not interact with unrelated browser tabs.
- If a test requires an unavailable external service, mark it **not run** with the precise missing dependency and identify a safe reproducible command. Do not change product code merely to make a test green. Fix verified implementation regressions within scope and add focused regression coverage.
- Update this prompt's execution record and the relevant contract/coverage documentation with tested connection, command, result, and remaining gap. Keep behavior maps unchanged when testing causes no runtime behavior change.

## Acceptance report

Return a concise matrix with connection/family, evidence/command, result (pass/fail/not run), and data owner. Include test counts, skipped integration tests and why, sandbox build/DB readiness, browser-tested flows, performance measurements, uncovered/advertised-only routes, and any failures with file/route evidence. Do not call the entire architecture “fully verified” when only representative flows passed.

## Execution record

Append date, exact commands and outcomes here. Distinguish prior results from this execution. Never store secrets, tokens, personal data, or unredacted logs in this file.

### 2026-11-14 execution

- Sorye Hub: `pnpm exec tsc --noEmit -p apps/hub` passed. `pnpm --filter @sorye/hub test:rodrigo` passed 46, failed 0, skipped 2. Contract snapshot equivalence and signed Node/Rust request checks passed. Skips: the opt-in live PostgreSQL cutover and identity/provider suites were not configured in this shell.
- Rodrigo: `cargo fmt --check`, `cargo clippy --locked --all-targets -- -D warnings`, and `cargo test --locked` passed. Twelve isolated-provider PostgreSQL/MySQL/MongoDB/Redis/S3 integration tests were ignored because `compose.test.yml` providers are not configured.
- Sandbox: Hub capability endpoint reported Rodrigo `dataReady=true`, PostgreSQL and S3 `ready`; sandbox PostgreSQL accepted connections and retained the two Drive folder records. Prior same-day browser verification exercised Drive create/nested upload/download and workspace rejection at `http://127.0.0.1:23000/apps/files`. This is representative Drive evidence only, not end-to-end verification of every migrated app family.
- Remaining: isolated multi-provider test configuration is needed for the skipped suites; no live customer AWS/R2 connection or every-app browser journey was exercised during this run. No external credentials were read or printed.
