import { randomUUID } from 'node:crypto';
import type { PlatformAuditAppend } from '@sorye/types';
import { appendPlatformAudit } from '@/lib/rodrigo/platform-client';
import type { AdminActor } from './access';

type Details = PlatformAuditAppend['details'];

export class AdminAuditUnavailableError extends Error {
  constructor() {
    super('Audit log is unavailable; the action was not performed.');
  }
}

export type AuditedRun<T> = { outcome: 'succeeded' | 'failed'; result: T; details?: Details };

export interface AuditedResult<T> {
  result: T;
  correlationId: string;
  /** False when the action ran but its outcome event could not be recorded. */
  outcomeRecorded: boolean;
}

/**
 * Hub-owned admin actions (plans, notices, runtime stop) live outside Rodrigo's
 * transaction, so they are bracketed: a pending intent must be durable before the
 * action runs, then the outcome is appended. Config writes are audited atomically
 * by Rodrigo itself and do not use this helper.
 */
export async function auditedAdminAction<T>(
  actor: AdminActor,
  event: { action: string; targetType: string; targetId: string; details?: Details },
  run: () => Promise<{ outcome: 'succeeded' | 'failed'; result: T; details?: Details }>,
): Promise<AuditedResult<T>> {
  const correlationId = randomUUID();
  const base = { action: event.action, targetType: event.targetType, targetId: event.targetId, correlationId };
  try {
    await appendPlatformAudit(actor.actorId, { ...base, eventId: randomUUID(), outcome: 'pending', details: event.details ?? {} });
  } catch {
    throw new AdminAuditUnavailableError();
  }
  let completed: { outcome: 'succeeded' | 'failed'; result: T; details?: Details };
  try {
    completed = await run();
  } catch (error) {
    await appendPlatformAudit(actor.actorId, { ...base, eventId: randomUUID(), outcome: 'failed', details: { code: 'exception' } }).catch(() => undefined);
    throw error;
  }
  const outcomeRecorded = await appendPlatformAudit(actor.actorId, {
    ...base,
    eventId: randomUUID(),
    outcome: completed.outcome,
    details: completed.details ?? {},
  }).then(() => true, () => false);
  if (!outcomeRecorded) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'admin_audit_outcome_unrecorded', action: event.action, correlationId }));
  }
  return { result: completed.result, correlationId, outcomeRecorded };
}
