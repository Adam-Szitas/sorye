import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlatformAuditEvent } from '@sorye/types';
import { auditCsv, filterAuditEvents } from '../lib/admin/audit-review';

const event = { occurredAt: '2026-11-15T00:00:00Z', auditId: 'a', actorId: '=HYPERLINK("unsafe")', action: 'workspace.plan.assign', targetType: 'workspace', targetId: 'tenant-one', outcome: 'failed', correlationId: 'reference-one', namespace: null, revision: null, changeId: null, details: { secret: 'never-export-this' } } as PlatformAuditEvent;
test('audit search matches references and outcomes but excludes arbitrary details', () => {
  assert.equal(filterAuditEvents([event], 'REFERENCE-ONE', 'failed').length, 1);
  assert.equal(filterAuditEvents([event], '', 'committed').length, 0);
  assert.equal(filterAuditEvents([event], 'never-export-this', '').length, 0);
});
test('audit export quotes cells, neutralizes formulas, and omits details', () => {
  const csv = auditCsv([event]);
  assert.ok(csv.includes('"\'=HYPERLINK(""unsafe"")"'));
  assert.ok(!csv.includes('never-export-this'));
  assert.equal(csv.split('\r\n').length, 2);
});
