import type {
  WorkspaceEventName,
  WorkspaceEventPayload,
} from '@sorye/types';

export interface EmitEventResult {
  alive: boolean;
  delivered: boolean;
  reason?: string;
}

export async function emitWorkspaceEvent(
  name: WorkspaceEventName,
  payload: WorkspaceEventPayload,
): Promise<EmitEventResult | null> {
  try {
    const res = await fetch('/api/events', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, payload }),
    });
    if (!res.ok) return null;
    return (await res.json()) as EmitEventResult;
  } catch {
    return null;
  }
}
