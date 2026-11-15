# Superuser operations: plan and implementation prompt

Build an admin-only Operations page for common SaaS support and operational work. Reuse existing guarded console routes and signed Rodrigo services. Never expose tenant content, secrets, impersonation, or unsupported destructive actions.

## Introduce now

Provide searchable workflows grouped into customer support, reliability, and governance. Each workflow must explain the trigger, ordered investigation/action steps, supported destination, verification, and limitations. Include tenant access and plan troubleshooting, app availability, AI overload, failed uploads, provider outages, and configuration rollback. Links must use existing admin routes. Search must include steps and categories, have an accessible label and empty result state, and support keyboard navigation. Use native disclosure controls to keep the page compact. Do not persist incident notes or tenant identifiers in browser storage.

Flow: administrator signs in on the admin host → selects Operations → searches for the symptom → opens a workflow → follows links to existing authorized controls → verifies the result → checks configuration history. The page is guidance, not evidence that an operation succeeded.

## Subsequent implementation priorities

1. Tenant support dossier: bounded tenant lookup, membership and entitlement summary, storage usage, recent failures, and correlation IDs. Rodrigo must expose a dedicated authorized aggregate; do not collect customer document bodies.
2. Tenant lifecycle and feature controls: suspend/reactivate and per-tenant app availability with a reason, preview of impact, expected revision, idempotent change ID, and atomic Rodrigo audit. Avoid destructive deletion in the first release.
3. Incident management: maintenance notices with start/end times, affected services, owner, and acknowledgement. Rodrigo owns durable incidents and delivery; Hub displays status.
4. Governance: searchable audit export with server-side pagination, redaction, retention policy, and access checks. Recent authentication and multi-person approval are prerequisites for credential rotation and destructive actions.
5. Billing support: provider-backed reconciliation and subscription status; do not simulate successful payment or refunds without a payment-provider contract.

These follow-up features are planned, not controls implemented by the Operations guide. Before adding any write, define Rodrigo contracts, DTOs, authorization, audit semantics, concurrency/failure behavior, and migration order.

## Acceptance

## Implemented operations desk

The page now mounts the selected operational tool: tenant review/plan controls, scheduled notices, AI configuration/response, audit review/export, or runbooks. Workspace IDs resolve through the existing signed Rodrigo platform endpoint without enumerating tenants. Audit filtering and metadata-only CSV operate on bounded server pages, retain cursor navigation, and exclude arbitrary details. Exports neutralize spreadsheet formulas. Existing guards and audited mutation handlers are reused. No new backend ownership or Rodrigo schema was introduced. The subsequent priorities above remain future contract work.

The Operations route must call adminAccess and appear only in the existing admin navigation. No new APIs, database ownership, or configuration namespaces are needed for the guide. Update both behavior maps and the admin runbook. Run Hub TypeScript and admin access/settings tests. Do not rebuild the sandbox.
