import { randomUUID } from 'crypto';
import {
  createDefaultNotificationSettings,
  type NotificationCenterSettings,
  type NotificationSnapshot,
  type WorkspaceNotification,
} from '@sorye/types';
import {
  countMessengerUnread,
  markMessengerRead,
} from '@/lib/messenger-unread';
import { jsonDataFile } from '@/lib/store/json-file';

const MAX_NOTIFICATIONS = 200;

interface NotificationStore {
  [workspaceId: string]: WorkspaceNotification[];
}

interface ReadStore {
  [workspaceId: string]: {
    [userId: string]: string[];
  };
}

interface SettingsStore {
  [workspaceId: string]: {
    [userId: string]: NotificationCenterSettings;
  };
}

const notificationsFile = jsonDataFile<NotificationStore>(
  'notifications.json',
  () => ({}),
);
const readStateFile = jsonDataFile<ReadStore>(
  'notification-read.json',
  () => ({}),
);
const settingsFile = jsonDataFile<SettingsStore>(
  'notification-settings.json',
  () => ({}),
);

const readNotifications = () => notificationsFile.read();
const readReadState = () => readStateFile.read();
const readSettingsStore = () => settingsFile.read();

function normalizeSettings(
  raw: Partial<NotificationCenterSettings> | undefined,
): NotificationCenterSettings {
  const defaults = createDefaultNotificationSettings();
  return {
    toastsEnabled: raw?.toastsEnabled === true,
    toastApps: { ...defaults.toastApps, ...(raw?.toastApps ?? {}) },
    updatedAt: raw?.updatedAt,
  };
}

export async function getNotificationSettings(
  workspaceId: string,
  userId: string,
): Promise<NotificationCenterSettings> {
  const store = await readSettingsStore();
  return normalizeSettings(store[workspaceId]?.[userId]);
}

export async function setNotificationSettings(
  workspaceId: string,
  userId: string,
  patch: Partial<NotificationCenterSettings>,
): Promise<NotificationCenterSettings> {
  return settingsFile.update((store) => {
    const current = normalizeSettings(store[workspaceId]?.[userId]);
    const next = normalizeSettings({
      ...current,
      ...patch,
      toastApps: patch.toastApps
        ? { ...current.toastApps, ...patch.toastApps }
        : current.toastApps,
      updatedAt: new Date().toISOString(),
    });
    store[workspaceId] = { ...(store[workspaceId] ?? {}), [userId]: next };
    return next;
  });
}

function readIdsForUser(
  readStore: ReadStore,
  workspaceId: string,
  userId: string,
): Set<string> {
  return new Set(readStore[workspaceId]?.[userId] ?? []);
}

function unreadCounts(
  notifications: WorkspaceNotification[],
  readIds: Set<string>,
): { unreadByApp: Record<string, number>; unreadTotal: number } {
  const unreadByApp: Record<string, number> = {};
  let unreadTotal = 0;
  for (const n of notifications) {
    if (readIds.has(n.id)) continue;
    unreadByApp[n.appId] = (unreadByApp[n.appId] ?? 0) + 1;
    unreadTotal += 1;
  }
  return { unreadByApp, unreadTotal };
}

export async function recordWorkspaceNotification(input: {
  workspaceId: string;
  appId: string;
  title: string;
  body?: string;
  eventName?: string;
}): Promise<WorkspaceNotification> {
  const notification: WorkspaceNotification = {
    id: `ntf-${randomUUID().slice(0, 10)}`,
    workspaceId: input.workspaceId,
    appId: input.appId,
    title: input.title.trim(),
    body: input.body?.trim() ?? '',
    eventName: input.eventName,
    createdAt: new Date().toISOString(),
  };
  await notificationsFile.update((store) => {
    const list = store[input.workspaceId] ?? [];
    store[input.workspaceId] = [notification, ...list].slice(
      0,
      MAX_NOTIFICATIONS,
    );
  });
  return notification;
}

export async function getNotificationSnapshot(input: {
  workspaceId: string;
  userId: string;
  limit?: number;
}): Promise<NotificationSnapshot> {
  const [store, readStore, settings] = await Promise.all([
    readNotifications(),
    readReadState(),
    getNotificationSettings(input.workspaceId, input.userId),
  ]);
  const notifications = (store[input.workspaceId] ?? []).slice(
    0,
    input.limit ?? 50,
  );
  const readIds = readIdsForUser(readStore, input.workspaceId, input.userId);
  const { unreadByApp, unreadTotal } = unreadCounts(notifications, readIds);

  const messengerUnread = await countMessengerUnread(
    input.userId,
    input.workspaceId,
  );
  if (messengerUnread > 0) {
    unreadByApp.messenger = (unreadByApp.messenger ?? 0) + messengerUnread;
  }
  const mergedUnreadTotal = unreadTotal + messengerUnread;

  return {
    notifications: notifications.map((n) => ({
      ...n,
      read: readIds.has(n.id),
    })),
    unreadByApp,
    unreadTotal: mergedUnreadTotal,
    settings,
  };
}

export async function markNotificationsRead(input: {
  workspaceId: string;
  userId: string;
  notificationIds?: string[];
  appId?: string;
  all?: boolean;
}): Promise<NotificationSnapshot> {
  const notificationsStore = await readNotifications();
  const notifications = notificationsStore[input.workspaceId] ?? [];

  if (input.all || input.appId === 'messenger') {
    await markMessengerRead({
      userId: input.userId,
      workspaceId: input.workspaceId,
    });
  }

  await readStateFile.update((readStore) => {
    const readIds = readIdsForUser(readStore, input.workspaceId, input.userId);

    if (input.all) {
      for (const n of notifications) readIds.add(n.id);
    } else if (input.appId) {
      for (const n of notifications) {
        if (n.appId === input.appId) readIds.add(n.id);
      }
    } else if (input.notificationIds) {
      for (const id of input.notificationIds) readIds.add(id);
    }

    readStore[input.workspaceId] = {
      ...(readStore[input.workspaceId] ?? {}),
      [input.userId]: [...readIds],
    };
  });

  return getNotificationSnapshot({
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
}
