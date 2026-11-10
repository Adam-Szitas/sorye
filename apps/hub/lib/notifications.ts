import { randomUUID } from 'crypto';
import {
  createDefaultNotificationSettings,
  type NotificationCenterSettings,
  type NotificationSnapshot,
  type WorkspaceNotification,
} from '@sorye/types';
import {
  accessibleMessengerChannelIds,
  listMessengerUnreadNotices,
  markMessengerRead,
  messengerReadMap,
  markMessengerUnreadNotices,
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

const readNotifications = (workspaceId: string) => notificationsFile.read(workspaceId);
const readReadState = (workspaceId: string) => readStateFile.read(workspaceId);
const readSettingsStore = (workspaceId: string) => settingsFile.read(workspaceId);

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
  const store = await readSettingsStore(workspaceId);
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
  }, workspaceId);
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
  userId?: string;
  actorId?: string;
  appId: string;
  title: string;
  body?: string;
  eventName?: string;
  jobId?: string;
  analysisId?: string;
  channelId?: string;
  outcome?: 'success' | 'failure';
}): Promise<WorkspaceNotification> {
  const notification: WorkspaceNotification = {
    id: `ntf-${randomUUID().slice(0, 10)}`,
    workspaceId: input.workspaceId,
    userId: input.userId,
    actorId: input.actorId,
    appId: input.appId,
    title: input.title.trim(),
    body: input.body?.trim() ?? '',
    eventName: input.eventName,
    jobId: input.jobId,
    analysisId: input.analysisId,
    channelId: input.channelId,
    outcome: input.outcome,
    createdAt: new Date().toISOString(),
  };
  await notificationsFile.update((store) => {
    const list = store[input.workspaceId] ?? [];
    store[input.workspaceId] = [notification, ...list].slice(
      0,
      MAX_NOTIFICATIONS,
    );
  }, input.workspaceId);
  return notification;
}

export async function getNotificationSnapshot(input: {
  workspaceId: string;
  userId: string;
  limit?: number;
}): Promise<NotificationSnapshot> {
  const [store, readStore, settings] = await Promise.all([
    readNotifications(input.workspaceId),
    readReadState(input.workspaceId),
    getNotificationSettings(input.workspaceId, input.userId),
  ]);
  const readIds = readIdsForUser(readStore, input.workspaceId, input.userId);
  const [messengerNotices, channelIds, messengerRead] = await Promise.all([
    listMessengerUnreadNotices(input.userId, input.workspaceId),
    accessibleMessengerChannelIds(input.userId, input.workspaceId),
    messengerReadMap(input.userId, input.workspaceId),
  ]);
  const channelsWithUnread = new Set(messengerNotices.map((notice) => notice.channelId));
  const stored = (store[input.workspaceId] ?? [])
    // Addressed to someone else, or caused by this member's own action.
    .filter((notice) => (!notice.userId || notice.userId === input.userId) && notice.actorId !== input.userId)
    // A Messenger notice is only meaningful if the member can open that channel.
    // Without this the badge counts pings for channels that were deleted or that
    // the member never joined, and the app opens empty.
    .filter((notice) => {
      if (notice.appId !== 'messenger') return true;
      // Event notices without a channel mirror a message in #events, which the
      // unread rows below already list; keeping both double counts.
      if (!notice.channelId || !channelIds.has(notice.channelId)) return false;
      // A ping is superseded by the unread message row, and stale once the
      // member has read the channel past it.
      if (channelsWithUnread.has(notice.channelId)) return false;
      const readThrough = messengerRead[notice.channelId];
      return !readThrough || notice.createdAt > readThrough;
    });
  const merged = [
    ...messengerNotices.map((notice) => ({
      id: notice.id,
      workspaceId: input.workspaceId,
      userId: input.userId,
      appId: 'messenger',
      title: notice.title,
      body: notice.body,
      channelId: notice.channelId,
      createdAt: notice.createdAt,
    })),
    ...stored,
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Count everything unread, not only the rows the list shows, so the badge
  // matches what the member can reach.
  const { unreadByApp, unreadTotal } = unreadCounts(merged, readIds);
  const notifications = merged.slice(0, input.limit ?? 50);

  return {
    notifications: notifications.map((n) => ({
      ...n,
      read: n.id.startsWith('msgu:') ? false : readIds.has(n.id),
    })),
    unreadByApp,
    unreadTotal,
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
  const notificationsStore = await readNotifications(input.workspaceId);
  const notifications = notificationsStore[input.workspaceId] ?? [];

  const requestedIds = input.notificationIds ?? [];
  const messengerNoticeIds = requestedIds.filter((id) => id.startsWith('msgu:'));
  const storedIds = requestedIds.filter((id) => !id.startsWith('msgu:'));

  if (input.all || input.appId === 'messenger') {
    await markMessengerRead({
      userId: input.userId,
      workspaceId: input.workspaceId,
    });
  } else if (messengerNoticeIds.length > 0) {
    await markMessengerUnreadNotices({
      userId: input.userId,
      workspaceId: input.workspaceId,
      noticeIds: messengerNoticeIds,
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
    } else if (storedIds.length > 0) {
      for (const id of storedIds) readIds.add(id);
    }

    readStore[input.workspaceId] = {
      ...(readStore[input.workspaceId] ?? {}),
      [input.userId]: [...readIds],
    };
  }, input.workspaceId);

  return getNotificationSnapshot({
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
}
