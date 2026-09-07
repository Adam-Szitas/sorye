/** Workspace notifications — badges, center feed, toast preferences. */

export const NOTIFICATION_BROADCAST_CHANNEL = 'sorye-notifications';

export interface WorkspaceNotification {
  id: string;
  workspaceId: string;
  appId: string;
  title: string;
  body: string;
  eventName?: string;
  createdAt: string;
}

/** Notification row returned to the Hub UI (includes read state). */
export interface WorkspaceNotificationItem extends WorkspaceNotification {
  read: boolean;
}

export interface NotificationCenterSettings {
  /** Master switch for on-screen toast popups. */
  toastsEnabled: boolean;
  /** Per-app toast opt-in (only used when toastsEnabled). */
  toastApps: Record<string, boolean>;
  updatedAt?: string;
}

export interface NotificationSnapshot {
  notifications: WorkspaceNotificationItem[];
  unreadByApp: Record<string, number>;
  unreadTotal: number;
  settings: NotificationCenterSettings;
}

/** Same-window signal from micro-frontends after POST /api/events (BroadcastChannel is same-origin only). */
export const HUB_NOTIFY_EVENT = 'sorye:hub:notify';

export interface NotificationBroadcastMessage {
  type: 'notification-created' | 'notifications-read';
  workspaceId?: string;
  notification?: WorkspaceNotification;
}

export const NOTIFIABLE_APP_IDS = [
  'ocr',
  'protocolio',
  'messenger',
  'calendar',
  'tasks',
  'notes',
  'relay',
  'dashboard',
  'studio',
  'mail',
] as const;

export function createDefaultNotificationSettings(
  appIds: string[] = [...NOTIFIABLE_APP_IDS],
): NotificationCenterSettings {
  const toastApps = Object.fromEntries(appIds.map((id) => [id, true]));
  return {
    toastsEnabled: false,
    toastApps,
  };
}

export function shouldToastForApp(
  settings: NotificationCenterSettings,
  appId: string,
): boolean {
  if (!settings.toastsEnabled) return false;
  return settings.toastApps[appId] !== false;
}
