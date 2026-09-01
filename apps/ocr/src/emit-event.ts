import {
  HUB_NOTIFY_EVENT,
  NOTIFICATION_BROADCAST_CHANNEL,
  RELAY_BROADCAST_CHANNEL,
  type RelayBroadcastMessage,
  type WorkspaceEventName,
  type WorkspaceEventPayload,
} from '@sorye/types';

export interface EmitEventResult {
  alive: boolean;
  delivered: boolean;
  reason?: string;
}

function notifyHub() {
  try {
    window.dispatchEvent(new CustomEvent(HUB_NOTIFY_EVENT));
    const relay = new BroadcastChannel(RELAY_BROADCAST_CHANNEL);
    relay.postMessage({ type: 'relay-updated' } satisfies RelayBroadcastMessage);
    relay.close();
    const notif = new BroadcastChannel(NOTIFICATION_BROADCAST_CHANNEL);
    notif.postMessage({ type: 'notification-created' });
    notif.close();
  } catch {
    // ignore
  }
}

/** Fire-and-forget friendly: returns null on network failure. */
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
    notifyHub();
    return (await res.json()) as EmitEventResult;
  } catch {
    return null;
  }
}
