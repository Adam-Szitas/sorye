'use client';

import Link from 'next/link';
import { useState } from 'react';

const workflows = [
  { title: 'A customer cannot access an app', category: 'Customer support', href: '/admin/workspaces', destination: 'Workspaces and access', steps: ['Identify the affected workspace and confirm the reporting user belongs to it.', 'Inspect the workspace plan and enabled applications before changing an entitlement.', 'Open Applications to check the application configuration and dependencies.', 'Ask the user to retry in the correct workspace, then review the recorded administrative change.'], limitation: 'Membership editing and user impersonation are not available here.' },
  { title: 'An application or provider is unavailable', category: 'Reliability', href: '/admin', destination: 'Overview', steps: ['Check platform health and recent errors; record the time and affected service.', 'Compare service errors with request load and usage to establish the scope.', 'Open Integrations and storage to inspect the failing dependency.', 'After recovery, repeat the affected operation and check that errors stop increasing.'], limitation: 'Container deployment and credential rotation require the deployment runbook.' },
  { title: 'AI requests are overloaded or failing', category: 'Reliability', href: '/admin/ai', destination: 'AI and workers', steps: ['Inspect the provider, current configuration revision and consumer reports.', 'Pause new requests when continued admission would worsen the incident.', 'Wait for Hub and the OCR worker to report the paused revision.', 'Adjust supported limits or restore a known revision, resume admission and verify a representative request.'], limitation: 'Pause lets running work finish. Stop and unload affects Hub requests only; it does not cancel OCR worker jobs.' },
  { title: 'Uploads fail or storage is full', category: 'Customer support', href: '/admin/integrations', destination: 'Integrations and storage', steps: ['Record the selected destination and the upload error, without copying file contents.', 'Check storage health, reported capacity and configured upload limits.', 'Inspect the relevant application settings before adjusting supported limits.', 'Retry a small permitted file in the same destination and verify its download.'], limitation: 'Do not switch customers to another storage destination silently. Connected buckets may not report a total capacity.' },
  { title: 'A configuration change caused a regression', category: 'Governance', href: '/admin/history', destination: 'Configuration history', steps: ['Locate the change by time and configuration revision.', 'Review the changed values and affected consumers.', 'For shared AI, open AI and workers and restore the required earlier revision as a new change.', 'Verify consumer acknowledgement and the original customer operation; retain the audit history.'], limitation: 'History is not a universal undo tool. Non-AI changes require the relevant supported control or deployment runbook.' },
  { title: 'Prepare an operational handover', category: 'Governance', href: '/admin/releases', destination: 'Releases and infrastructure', steps: ['Record the deployed versions and unresolved service failures.', 'Review pending configuration propagation and recent administrative changes.', 'Record affected services, next action and an accountable operator in your incident system.', 'Have the receiving operator verify readiness and the outstanding customer cases.'], limitation: 'This guide does not store incident notes, certify backups or execute releases.' },
] as const;

export function AdminOperations() {
  const [query, setQuery] = useState('');
  const visible = workflows.filter(item => [item.title, item.category, ...item.steps, item.limitation].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="admin-page">
    <header><h1>Operations</h1><p className="admin-lede">Start with the customer symptom, investigate its scope, use the appropriate control, then verify recovery and review the audit history.</p></header>
    <label className="admin-section">Find an administrative workflow<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Access, uploads, AI, rollback…" className="rounded-lg border p-3 bg-transparent" /></label>
    <p className="admin-muted" role="status">{visible.length} workflows found</p>
    <div className="admin-section">{visible.map(item => <details key={item.title} className="admin-card">
      <summary className="cursor-pointer py-2 font-semibold">{item.title} <span className="admin-muted">({item.category})</span></summary>
      <ol className="list-decimal pl-6 space-y-2 my-4">{item.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <p className="admin-muted">{item.limitation}</p>
      <Link href={item.href} prefetch={false} className="inline-block py-3 underline">Open {item.destination}</Link>
    </details>)}</div>
    {!visible.length && <p>No matching workflow. Try “access”, “storage” or “configuration”. <button type="button" className="underline p-2" onClick={() => setQuery('')}>Clear search</button></p>}
  </div>;
}
