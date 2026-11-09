# Rodrigo database switching runbook

## State and scope

This is a **pre-production, no-migration** cutover. Existing Hub JSON/PostgreSQL records, browser localStorage records, and Hub-owned job state are not copied. After a domain is switched, missing Rodrigo state is treated as empty/default state. Operators must tell affected users that old Hub-owned data may be unavailable. Do not enable a Rodrigo app until its Hub writer is disabled and the app's write, read, retry, and outage checks below pass.

The implemented v2 slices are Tasks, Notes, Calendar, Canvas, Site page editing and published public reads, Storefront products and enquiry orders, workspace profile name/read, and Messenger channels/text. They use Hub routes and Rodrigo v2; their legacy resource writers are disabled. This list is not a claim of full app coverage or rollout certification. Messenger attachments/read receipts, Canvas realtime invalidation, event delivery, Storefront status transitions, workspace/team policy, most other catalog apps, and external side effects remain uncovered. Check the [durable contract status](RODRIGO-DATA-CONTRACT.md) before enabling any slice.

## Deployment order and gates

1. Back up the disposable or production PostgreSQL database and rehearse restore into an isolated database. Verify the restore before deployment. Never point verification at customer data.
2. Deploy Rodrigo first at a digest pinned release. The authoritative contracts are `contracts/rodrigo.openapi.json`; v1 remains for deployed readers. The additive action API is `/v2/actions/batch`. Apply `migrations/postgresql/002_actions.sql`, `003_action_actor.sql`, and `004_site_public_slugs.sql` to the dedicated authoritative PostgreSQL database using the migration job. Rodrigo action commits are PostgreSQL-only; MongoDB/MySQL document adapters do not own v2 action data. Readiness checks the slug table, so a missing `004` migration fails closed.
3. Require `/health/live`, `/health/ready`, migration table checks, and signed contract tests to pass. Liveness means process only. Readiness must prove the action receipt/resource tables are writable. Stop if the action store is unconfigured or any startup check falls back to another provider.
4. Configure Hub's server-only `RODRIGO_BASE_URL`, `RODRIGO_KEY_ID`, and `RODRIGO_PRIVATE_KEY_FILE`. Use HTTPS in production, verify key file access is limited to Hub, and verify the matching public key is installed in Rodrigo. Rotate by adding a new Rodrigo verification key, switching Hub's key id/private key, confirming traffic, then removing the retired key after the 30-second assertion lifetime and deployment overlap.
5. Deploy Hub after Rodrigo. Keep `RODRIGO_DOCUMENT_OWNERS` unset unless using the separate legacy v1 migration path. Do not run that import path as part of the no-migration v2 cutover.
6. Enable one app only after its app-specific completion checklist below is met. Disable the old Hub store write route before routing any user write to Rodrigo. If the app is only partly integrated, leave its switch off.

## Verification for each app

Use a fresh test workspace, test user, test data, and the disposable PostgreSQL instance. For the current Tasks slice, verify board create/read/update/reload (board deletion is intentionally unsupported); other resource families may have their own create/read/update/delete matrix.

- Create, read, update, and delete through app → Hub → Rodrigo → PostgreSQL. Reload and restart Hub and Rodrigo; verify state remains the same.
- Send one action twice with the same UUID and identical bytes. Verify the second response is `duplicate` with the original commit/revision. Reuse that ID with changed payload and verify `conflict` without changing the stored resource.
- Simulate a lost response after commit, reconnect, and resend the identical queued action. Verify it resolves as `duplicate` and clears only that action.
- Stop Rodrigo and verify no Hub success or Hub-store fallback. Verify the app keeps the IndexedDB action through refresh/restart and exposes Resend. Restore Rodrigo and verify retry.
- Submit an action for another workspace and an action for a disabled app. Verify Hub denies both before signing and Rodrigo rejects missing/wrong signed scope.
- Force a resource revision conflict and verify the UI offers explicit reconciliation without replacing server data.
- Confirm logout/tab/window close reports remaining pending actions; these hooks are best effort and IndexedDB is still the recovery source.

## Rollback and stop conditions

Rollback means disable the new app route and show the service-unavailable/read-only state while preserving its IndexedDB queue. It must not re-enable Hub writes or read an old Hub copy as a fallback. If a v2 action has committed, keep Rodrigo as its authority during repair; a deployment rollback does not reverse committed data. Do not run two active writers. Stop a rollout on any false success acknowledgement, missing per-action result, authorization leak, PostgreSQL readiness failure, duplicate execution, changed-payload acceptance, unexplained revision gap, or queue loss.

Do not prune idempotency receipts while a corresponding action could still be retried. The current v2 migration retains receipts without deletion and sets a ten-year `retain_until` horizon. Any future pruning requires a proven maximum queue age and a non-replayable tombstone beyond that age.

## Operations

Keep Rodrigo's Prometheus and deployment dashboards private. Alert on provider readiness loss, failed/ambiguous action results, idempotency conflicts, 5xx/timeout rates, queue oldest-age, and last durable commit age. Logs must not include action payloads, assertions, provider credentials, or sensitive identifiers. Hub health and Rodrigo/provider health are separate signals. A healthy Hub process does not imply a durable write path.

## Definition of complete

An app is complete only when every persisted route, background worker, localStorage write, secret, blob, and external side effect in its inventory has an explicit Rodrigo contract; its old Hub writer is disabled; its app-owned IndexedDB queue scopes rows to user and workspace; commit acknowledgement, duplicate replay, conflict/resend, offline recovery, access denial, reload/restart, and provider outage are tested end to end; and operator readiness and metrics show the app/action family. Mail delivery, webhooks, file/OCR bytes, and other external effects also require durable jobs/status/leases and safe terminal failure before claiming completion. Catalog presence, API route names, a successful build, or a generic document endpoint do not count.

Current known incomplete areas include Messenger attachments and read receipts, Files/Drive blobs and metadata (task photos are Hub Drive files in the Tasks section, not a Rodrigo blob slice), Mail and SMTP, Relay/webhooks, Site publish events, Storefront status transitions, Canvas realtime invalidation, OCR jobs/documents, Studio, Dashboard/Reports/Operator/Catalog, workspace/member/settings policy writes, Protocolio generated artifacts, SUSM/ESPM, Contact, and Devtools. Maintain the inventory in `RODRIGO-DATA-CONTRACT.md` and the behavior maps as each family is completed.
