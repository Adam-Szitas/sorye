import type { KernelClient } from '@sorye/platform';
import type { WorkspaceEventName, WorkspaceEventPayload } from '@sorye/types';

type TaskEventName = Extract<
  WorkspaceEventName,
  'sorye.task.created' | 'sorye.task.updated' | 'sorye.task.moved'
>;

/** Task events go through the kernel, which posts to Hub `/api/events`. */
export function emitTaskEvent(
  kernel: KernelClient,
  name: TaskEventName,
  payload: WorkspaceEventPayload,
): Promise<unknown> {
  return kernel.emit({
    type: 'event',
    name,
    payload: { ...payload, appId: 'tasks' },
  });
}
