import {
  HUB_NOTIFY_EVENT,
  NOTIFICATION_BROADCAST_CHANNEL,
  RELAY_BROADCAST_CHANNEL,
  type HubSession,
} from '@sorye/types';
import type { KernelHost } from './host';
import { hubUrl } from './transport';
import { startVisibleRefresh } from './refresh';

/**
 * Pull session and notification unread from Hub.
 * Used when the shell is not already pushing those values (standalone tab,
 * or a Hub page that mounts a remote outside the shell).
 * `workspaceId` is taken from the JSON the server already scoped — it is not sent back.
 */
export function startKernelSync(host: KernelHost, hubOrigin?: string): () => void {
  if (typeof window === 'undefined') return () => {};

  const session = startVisibleRefresh(async (signal) => {
    const res = await fetch(hubUrl('/api/workspace', hubOrigin), {
      credentials: 'include', signal, cache: 'no-store', priority: 'low',
    });
    if (res.ok) {
      const data = await res.json() as HubSession;
      if (!signal.aborted) host.setSession(data);
    } else if (res.status === 401 && !signal.aborted) {
      host.setSession(null);
      host.setNotificationUnread(null);
    }
  }, { intervalMs: 300_000 });
  const notifications = startVisibleRefresh(async (signal) => {
    const res = await fetch(hubUrl('/api/notifications', hubOrigin), {
      credentials: 'include', signal, cache: 'no-store', priority: 'low',
    });
    if (!res.ok) return;
    const data = (await res.json()) as { unreadTotal?: unknown };
    if (!signal.aborted) host.setNotificationUnread(
      typeof data.unreadTotal === 'number' ? data.unreadTotal : null,
    );
  }, {
    intervalMs: 60_000,
    events: [HUB_NOTIFY_EVENT],
    channels: [NOTIFICATION_BROADCAST_CHANNEL, RELAY_BROADCAST_CHANNEL],
  });

  return () => {
    session.dispose();
    notifications.dispose();
  };
}
