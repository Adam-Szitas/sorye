import type { PlatformAuditEvent } from '@sorye/types';

/** Search metadata only; arbitrary audit details are not indexed or exported. */
export function filterAuditEvents(events: PlatformAuditEvent[], query: string, outcome: string) {
  const term = query.trim().toLowerCase();
  return events.filter(event => (!outcome || event.outcome === outcome) &&
    [event.auditId, event.actorId, event.action, event.targetType, event.targetId, event.correlationId, event.namespace ?? ''].some(value => value.toLowerCase().includes(term)));
}

export function auditCsv(events: PlatformAuditEvent[]): string {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows = events.map(e => [e.occurredAt, e.auditId, e.actorId, e.action, e.targetType, e.targetId, e.outcome, e.correlationId, e.revision]);
  return [['Occurred at', 'Audit ID', 'Actor', 'Action', 'Target type', 'Target ID', 'Outcome', 'Correlation ID', 'Revision'], ...rows].map(row => row.map(cell).join(',')).join('\r\n');
}
