# Tasks and Calendar migration to Rodrigo

Hub remains the browser/session gateway. This migration changes the authoritative writer of one workspace's Tasks or Calendar document. It does not move identity, general events, handoffs, jobs or Notes. Notes accepts 512 KB; Rodrigo accepts 256 KiB, so Notes ownership is rejected until the contract is compatible.

## Prepare and freeze

Back up the source database or `.data` and record the Hub/Rodrigo digests, schema version and exact ownership configuration. Configure Rodrigo's document provider and apply its migrations using the independent Rodrigo repository. Use the same target backend and provider ownership for verification and cutover. Keep the signing key secret and mounted read-only in Hub; set `RODRIGO_BASE_URL`, `RODRIGO_KEY_ID` and `RODRIGO_PRIVATE_KEY_FILE` in the server environment. Production requires HTTPS.

Stop admission of writes and drain all in-flight requests on **every** Hub replica and any direct source writers. Deploy a frozen entry in `RODRIGO_DOCUMENT_OWNERS` and restart the replicas. This is a server environment JSON array, not a browser setting:

```json
[{"workspaceId":"WORKSPACE","kind":"tasks","owner":"frozen"}]
```

Frozen documents remain readable; every write, including a browser legacy import, returns 503 and keeps the draft. Missing entries retain Hub ownership. Invalid configuration returns a storage error rather than falling back. A rolling deployment with mixed old/new owners is unsafe: keep write admission stopped throughout the cutover.

## Export, check and import

Run these commands from the repository root with the **same source-store settings, frozen ownership and signing environment** as Hub. The CLI does not automatically load `.env.local`. For JSON development, `pnpm --filter` runs from `apps/hub`, whose `.data` must be the source. Use a current workspace member with the app enabled. Paths below are examples; keep exports outside source control with restricted access.

```sh
pnpm --filter @sorye/hub documents:migrate-rodrigo export --user USER --workspace WORKSPACE --kind tasks --file /secure/tasks-export.json
pnpm --filter @sorye/hub documents:migrate-rodrigo import --file /secure/tasks-export.json
pnpm --filter @sorye/hub documents:migrate-rodrigo import --file /secure/tasks-export.json --apply --writers-stopped --receipt /secure/tasks-receipt.json
```

Use `calendar` for Calendar. Import defaults to a read-only dry run. `--writers-stopped` records the operator's prerequisite; it does not stop processes for you. Export and receipt files use exclusive creation and are never overwritten. The command checks membership, frozen ownership, domain validation, request size, source equality and target parity. It rejects source data that validation would silently normalize or drop; repair such data through the existing app before taking a new export.

The target must be pristine (revision zero, no document) or the exact revision-one import from a previous attempt. Tombstones and different target records are never overwritten. If a response is lost, keep the source frozen and rerun the command: it reads an atomic snapshot and reconciles the prior import instead of blindly replaying a write. Any changed target or mismatched source requires investigation; do not activate the receipt.

## Activate the verified owner

The receipt contains the owner entry, target revision and browser revision. Merge its `owner` entry into the full deployment array, replacing only this workspace/kind's frozen entry. For example, importing Hub revision 12 creates Rodrigo revision 1 and produces:

```json
[{"workspaceId":"WORKSPACE","kind":"tasks","owner":"rodrigo","revisionOffset":12}]
```

Deploy the identical array to every Hub replica while writes remain drained. Browser revision is Rodrigo revision plus this offset, so the imported document appears at revision 13 and old browser revision 12 cannot overwrite it. Keep the offset unchanged for the lifetime of this ownership. Empty source documents use offset zero; remote tombstones always retain their revision. Browser legacy imports cannot resurrect tombstones. There is no automatic ownership switch, dual write or Hub fallback.

Verify the authenticated Hub GET and PUT path, disabled-app and non-member denial, stale-write 409, reload parity, and service-outage 503 before resuming traffic. Verify restore/failover with the deployment's actual provider. Preserve the original backup and receipt. Monitor request failures and latency during the canary. Do not remove the Hub identity database or credentials still used by unmigrated domains.

## Rollback and limitations

Do not delete the owner entry to roll back: that would expose stale Hub records and split authority. After any Rodrigo write, rollback requires draining writes, exporting the latest authoritative data and reconciling it into the intended owner with another reviewed migration. Image rollback alone is insufficient. All deployed Hub versions must understand the ownership configuration and revision offset.

Unmapped workspaces remain on their existing stores. This change does not automatically migrate customer data or activate a deployment. The capacity of an environment variable limits this mechanism to bounded rollout cohorts (at most 64 KiB / 1,000 entries); a larger fleet needs a durable control-plane ownership contract. General events and document SSE forwarding are separate work. Browser refresh behavior is unchanged.

## Verification

`pnpm rodrigo:test` runs signer, contract and routing checks. Set `RODRIGO_TEST_POSTGRES_URL` only to a disposable PostgreSQL database with Rodrigo's schema to enable the real-provider test. It starts fresh Rust processes and uses random workspace IDs; it also exercises the actual export/dry-run/import CLI against temporary Hub JSON files.

Local verification covers payload parity, 16 simultaneous writes (one winner, 15 conflicts), isolation, tombstone revisions, service restart, unavailable-service behavior without fallback, and CLI receipt generation. These tests do not prove production TLS, capacity, database failover or customer-record migration. No existing workspace was switched by implementation or testing.
