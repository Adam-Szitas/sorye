'use client';

import {
  HUB_NOTIFY_EVENT,
  NOTIFICATION_BROADCAST_CHANNEL,
  RELAY_BROADCAST_CHANNEL,
  shouldToastForApp,
  type NotificationCenterSettings,
  type NotificationSnapshot,
  type WorkspaceNotificationItem,
} from '@sorye/types';
import { startVisibleRefresh, type VisibleRefresh } from '@sorye/platform/host';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface ToastItem {
  id: string;
  appId: string;
  title: string;
  body: string;
}

interface NotificationContextValue {
  notifications: WorkspaceNotificationItem[];
  unreadByApp: Record<string, number>;
  unreadTotal: number;
  settings: NotificationCenterSettings;
  centerOpen: boolean;
  toasts: ToastItem[];
  openCenter: () => void;
  closeCenter: () => void;
  refresh: () => Promise<void>;
  markRead: (notificationIds: string[]) => Promise<void>;
  markAppRead: (appId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  openNotification: (notification: WorkspaceNotificationItem) => void;
  updateSettings: (
    patch: Partial<Pick<NotificationCenterSettings, 'toastsEnabled' | 'toastApps'>>,
  ) => Promise<void>;
  dismissToast: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return ctx;
}

interface NotificationProviderProps {
  workspaceId: string | undefined;
  onNavigateToApp: (appId: string) => void;
  children: ReactNode;
}

export function NotificationProvider({
  workspaceId,
  onNavigateToApp,
  children,
}: NotificationProviderProps) {
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null);
  const [centerOpen, setCenterOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const knownIds = useRef<Set<string>>(new Set());
  const toastedIds = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  // Bumped on workspace switch/unmount so in-flight responses for the old
  // workspace are discarded instead of clobbering the new one.
  const generation = useRef(0);
  const refreshController = useRef<VisibleRefresh | null>(null);
  const lastSignature = useRef('');
  const onNavigateRef = useRef(onNavigateToApp);
  onNavigateRef.current = onNavigateToApp;

  const enqueueToasts = useCallback(
    (
      items: WorkspaceNotificationItem[],
      settings: NotificationCenterSettings,
    ) => {
      if (!settings.toastsEnabled) return;

      const candidates = items.filter(
        (n) =>
          !toastedIds.current.has(n.id) &&
          shouldToastForApp(settings, n.appId),
      );
      if (candidates.length === 0) return;

      for (const n of candidates) toastedIds.current.add(n.id);

      setToasts((prev) =>
        [
          ...candidates.map((n) => ({
            id: n.id,
            appId: n.appId,
            title: n.title,
            body: n.body,
          })),
          ...prev,
        ].slice(0, 5),
      );
    },
    [],
  );

  const ingestSnapshot = useCallback(
    (next: NotificationSnapshot, mode: 'seed' | 'live' | 'settings') => {
      // Skip the state update (and the re-render of every consumer) when
      // the polled payload is identical to what we already have.
      const signature = JSON.stringify(next);
      if (signature !== lastSignature.current) {
        lastSignature.current = signature;
        setSnapshot(next);
      }

      const currentIds = new Set(next.notifications.map((n) => n.id));

      if (mode === 'seed') {
        knownIds.current = currentIds;
        seeded.current = true;
        return;
      }

      const fresh = next.notifications.filter((n) => !knownIds.current.has(n.id));
      // Rebuild instead of accumulating so the sets stay bounded for
      // long-lived sessions.
      knownIds.current = currentIds;
      for (const id of [...toastedIds.current]) {
        if (!currentIds.has(id)) toastedIds.current.delete(id);
      }

      if (mode === 'settings' && next.settings.toastsEnabled) {
        const unread = next.notifications.filter((n) => !n.read);
        enqueueToasts(unread, next.settings);
        return;
      }

      if (fresh.length > 0) {
        enqueueToasts(fresh, next.settings);
      }
    },
    [enqueueToasts],
  );

  const refresh = useCallback(async () => {
    await refreshController.current?.refresh();
  }, []);

  useEffect(() => {
    generation.current += 1;
    seeded.current = false;
    knownIds.current = new Set();
    toastedIds.current = new Set();
    lastSignature.current = '';
    setSnapshot(null);
    setToasts([]);
    if (!workspaceId) return;

    const gen = generation.current;
    const controller = startVisibleRefresh(async (signal) => {
      const res = await fetch('/api/notifications', {
        credentials: 'include', signal, cache: 'no-store', priority: 'low',
      });
      if (!res.ok) return;
      const data = (await res.json()) as NotificationSnapshot;
      if (gen !== generation.current || signal.aborted) return;
      ingestSnapshot(data, seeded.current ? 'live' : 'seed');
    }, {
      intervalMs: 60_000,
      events: [HUB_NOTIFY_EVENT],
      channels: [RELAY_BROADCAST_CHANNEL, NOTIFICATION_BROADCAST_CHANNEL],
    });
    refreshController.current = controller;

    return () => {
      generation.current += 1;
      controller.dispose();
      if (refreshController.current === controller) refreshController.current = null;
    };
  }, [workspaceId, ingestSnapshot]);

  const markRead = useCallback(
    async (notificationIds: string[]) => {
      if (notificationIds.length === 0) return;
      const res = await fetch('/api/notifications', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-read', notificationIds }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as NotificationSnapshot;
      ingestSnapshot(data, 'live');
    },
    [ingestSnapshot],
  );

  const markAppRead = useCallback(
    async (appId: string) => {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark-read', appId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as NotificationSnapshot;
      ingestSnapshot(data, 'live');
    },
    [ingestSnapshot],
  );

  const markAllRead = useCallback(async () => {
    const res = await fetch('/api/notifications', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark-read', all: true }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as NotificationSnapshot;
    ingestSnapshot(data, 'live');
  }, [ingestSnapshot]);

  const updateSettings = useCallback(
    async (
      patch: Partial<
        Pick<NotificationCenterSettings, 'toastsEnabled' | 'toastApps'>
      >,
    ) => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return;
      const data = (await res.json()) as NotificationSnapshot;
      ingestSnapshot(
        data,
        patch.toastsEnabled === true ? 'settings' : 'live',
      );
    },
    [ingestSnapshot],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const openNotification = useCallback(
    (notification: WorkspaceNotificationItem) => {
      setCenterOpen(false);
      void markRead([notification.id]);
      dismissToast(notification.id);
      onNavigateRef.current(notification.appId);
    },
    [markRead, dismissToast],
  );

  const value = useMemo<NotificationContextValue>(
    () => ({
      notifications: snapshot?.notifications ?? [],
      unreadByApp: snapshot?.unreadByApp ?? {},
      unreadTotal: snapshot?.unreadTotal ?? 0,
      settings: snapshot?.settings ?? {
        toastsEnabled: false,
        toastApps: {},
      },
      centerOpen,
      toasts,
      openCenter: () => { setCenterOpen(true); void refresh(); },
      closeCenter: () => setCenterOpen(false),
      refresh,
      markRead,
      markAppRead,
      markAllRead,
      openNotification,
      updateSettings,
      dismissToast,
    }),
    [
      snapshot,
      centerOpen,
      toasts,
      refresh,
      markRead,
      markAppRead,
      markAllRead,
      openNotification,
      updateSettings,
      dismissToast,
    ],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function signalHubNotificationRefresh() {
  try {
    window.dispatchEvent(new CustomEvent(HUB_NOTIFY_EVENT));
  } catch {
    // ignore
  }
}
