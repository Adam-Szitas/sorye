import { createDurableActionQueue, type DurableActionQueue } from '@sorye/platform';
import type { RodrigoAction, RodrigoActionResult } from '@sorye/types';

export type TaskQueueStatus = 'pending' | 'failed' | 'conflict' | 'rejected';
export interface TaskQueueRow {
  scope: string;
  action: RodrigoAction;
  createdAt: number;
  attempts: number;
  status: TaskQueueStatus;
  error?: string;
}

export function classifyTaskActionOutcome(outcome: Pick<RodrigoActionResult, 'status' | 'error'>): 'acknowledged' | TaskQueueStatus {
  if (outcome.status === 'committed' || outcome.status === 'duplicate') return 'acknowledged';
  if (outcome.status === 'conflict') return 'conflict';
  return outcome.error?.code === 'provider_unavailable' ? 'failed' : 'rejected';
}

const queues = new Map<string, DurableActionQueue<RodrigoAction>>();
const MAX_QUEUE_ROWS_PER_SCOPE = 200;

function queue(scope: string) {
  let instance = queues.get(scope);
  if (!instance) {
    instance = createDurableActionQueue<RodrigoAction>({ appId: 'tasks', scope, maxRows: MAX_QUEUE_ROWS_PER_SCOPE });
    queues.set(scope, instance);
  }
  return instance;
}

function row(scope: string, item: Awaited<ReturnType<DurableActionQueue<RodrigoAction>['list']>>[number]): TaskQueueRow {
  return { scope, action: item.action, createdAt: item.createdAt, attempts: item.attempts, status: item.status, ...(item.lastError ? { error: item.lastError.message ?? item.lastError.code } : {}) };
}

export async function listTaskActions(scope: string): Promise<TaskQueueRow[]> {
  return (await queue(scope).list()).map((item) => row(scope, item));
}

export async function enqueueTaskAction(scope: string, action: RodrigoAction): Promise<TaskQueueRow> {
  return row(scope, await queue(scope).enqueue(action));
}

export async function updateTaskAction(scope: string, item: TaskQueueRow): Promise<void> {
  const q = queue(scope);
  if (item.status === 'pending') await q.markAttempt(item.action.actionId);
  else if (item.status === 'failed') await q.markTransportFailure(item.action.actionId, { code: 'transport_failure', message: item.error });
  else await q.settle({ actionId: item.action.actionId, status: item.status, error: item.error ? { code: item.error, message: item.error } : undefined });
}

export async function removeTaskAction(scope: string, actionId: string): Promise<void> {
  const q = queue(scope);
  // The queue only clears acknowledged actions automatically. Explicit removal
  // remains available to the user's conflict/rejection reconciliation UI.
  await q.discard(actionId);
}
