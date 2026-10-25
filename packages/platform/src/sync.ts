import {
  HUB_NOTIFY_EVENT,
  NOTIFICATION_BROADCAST_CHANNEL,
  RELAY_BROADCAST_CHANNEL,
  type HubSession,
} from '@sorye/types';
import type { KernelHost } from './host';
import { hubUrl } from './transport';

const SYNC_INTERVAL_MS = 30_000;

/**
 * Pull session and notification unread from Hub.
 * Used when the shell is not already pushing those values (standalone tab,
 * or a Hub page that mounts a remote outside the shell).
 * `workspaceId` is taken from the JSON the server already scoped — it is not sent back.
 */
export function startKernelSync(host: KernelHost, hubOrigin?: string): () => void {
  if (typeof window === 'undefined') return () => {};

  let stopped = false;

  const pull = async () => {
    if (stopped) return;
    try {
      const res = await fetch(hubUrl('/api/workspace', hubOrigin), {
        credentials: 'include',
      });
      if (res.ok && !stopped) {
        host.setSession((await res.json()) as HubSession);
      }
    } catch {
      // Hub unreachable from this origin until VITE_HUB_ORIGIN / CORS is set.
    }
    if (stopped) return;
    try {
      const res = await fetch(hubUrl('/api/notifications', hubOrigin), {
        credentials: 'include',
      });
      if (!res.ok || stopped) return;
      const data = (await res.json()) as { unreadTotal?: unknown };
      host.setNotificationUnread(
        typeof data.unreadTotal === 'number' ? data.unreadTotal : null,
      );
    } catch {
      // ignore
    }
  };

  void pull();

  const onNotify = () => {
    void pull();
  };
  window.addEventListener(HUB_NOTIFY_EVENT, onNotify);

  let notif: BroadcastChannel | null = null;
  let relay: BroadcastChannel | null = null;
  try {
    notif = new BroadcastChannel(NOTIFICATION_BROADCAST_CHANNEL);
    notif.onmessage = onNotify;
    relay = new BroadcastChannel(RELAY_BROADCAST_CHANNEL);
    relay.onmessage = onNotify;
  } catch {
    // ignore
  }

  const timer = window.setInterval(() => {
    void pull();
  }, SYNC_INTERVAL_MS);

  return () => {
    stopped = true;
    window.removeEventListener(HUB_NOTIFY_EVENT, onNotify);
    notif?.close();
    relay?.close();
    window.clearInterval(timer);
  };
}
