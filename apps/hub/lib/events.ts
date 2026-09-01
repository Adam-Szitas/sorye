import { randomUUID } from 'crypto';
import {
  DEFAULT_EVENT_SETTINGS,
  EVENTS_CHANNEL_NAME,
  SYSTEM_EVENTS_AUTHOR,
  formatEventMessageText,
  isMessengerEventsEligible,
  relaySourceFromEventName,
  type HubSession,
  type WorkspaceEvent,
  type WorkspaceEventName,
  type WorkspaceEventPayload,
  type WorkspaceEventSettings,
  type WorkspaceNotification,
} from '@sorye/types';
import { deliverEventViaRelay } from '@/lib/relay';
import { recordWorkspaceNotification } from '@/lib/notifications';
import { jsonDataFile } from '@/lib/store/json-file';
import { ensureEventsChannel, postSystemMessage } from '@/lib/store/messenger';
import { getHubSession, getHubSessionForWorkspace } from '@/lib/store';

type SettingsStore = Record<string, WorkspaceEventSettings>;
type ActivatedStore = Record<string, boolean>;

const settingsFile = jsonDataFile<SettingsStore>(
  'event-settings.json',
  () => ({}),
);
const activatedFile = jsonDataFile<ActivatedStore>(
  'event-activated.json',
  () => ({}),
);

const readSettings = () => settingsFile.read();

function normalizeSettings(
  raw: Partial<WorkspaceEventSettings> | undefined,
): WorkspaceEventSettings {
  return {
    ...DEFAULT_EVENT_SETTINGS,
    ...raw,
    // Older saves may lack `enabled` — treat missing as off.
    enabled: raw?.enabled === true,
    deliverToMessengerEvents: raw?.deliverToMessengerEvents !== false,
  };
}

export async function getEventSettings(
  workspaceId: string,
): Promise<WorkspaceEventSettings> {
  const store = await readSettings();
  return normalizeSettings(store[workspaceId]);
}

export async function setEventSettings(
  workspaceId: string,
  patch: Partial<WorkspaceEventSettings>,
): Promise<WorkspaceEventSettings> {
  return settingsFile.update((store) => {
    const next = normalizeSettings({
      ...store[workspaceId],
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    store[workspaceId] = next;
    return next;
  });
}

export interface PublishEventResult {
  eligible: boolean;
  enabled: boolean;
  alive: boolean;
  delivered: boolean;
  event: WorkspaceEvent;
  notification?: WorkspaceNotification;
  messageId?: string;
  channelId?: string;
  reason?: string;
}

async function maybeRecordNotification(
  event: WorkspaceEvent,
  workspaceId: string,
): Promise<WorkspaceNotification | undefined> {
  if (event.name.startsWith('sorye.system.')) return undefined;
  if (event.name === 'sorye.test.ping') return undefined;

  const appId =
    (typeof event.payload.appId === 'string' ? event.payload.appId : null) ??
    relaySourceFromEventName(event.name);
  if (!appId) return undefined;

  return recordWorkspaceNotification({
    workspaceId,
    appId,
    title: event.payload.title,
    body: event.payload.summary?.trim() ?? '',
    eventName: event.name,
  });
}

async function resolveSession(
  userId: string,
  workspaceId: string,
): Promise<HubSession | null> {
  const active = await getHubSession(userId);
  if (active?.workspace.id === workspaceId) return active;
  return getHubSessionForWorkspace(userId, workspaceId);
}

async function postActivationMessage(
  workspaceId: string,
  channelId: string,
) {
  await postSystemMessage(
    workspaceId,
    channelId,
    formatEventMessageText({
      name: 'sorye.system.events_activated',
      payload: {
        title: 'App events are on',
        summary:
          'Core movements from Tasks, Calendar, and Notes will show up here. Turn this off anytime from Dashboard → App events.',
        appId: 'messenger',
      },
    }),
    { ...SYSTEM_EVENTS_AUTHOR },
  );
}

export async function publishWorkspaceEvent(input: {
  userId: string;
  workspaceId: string;
  name: WorkspaceEventName;
  payload: WorkspaceEventPayload;
}): Promise<PublishEventResult | null> {
  const session = await resolveSession(input.userId, input.workspaceId);
  if (!session) return null;

  const event: WorkspaceEvent = {
    id: `evt-${randomUUID().slice(0, 10)}`,
    workspaceId: input.workspaceId,
    name: input.name,
    payload: input.payload,
    actor: {
      id: session.user.id,
      name: session.user.displayName,
    },
    createdAt: new Date().toISOString(),
  };

  const eligible = isMessengerEventsEligible(session.workspace.selectedAppIds);
  const settings = await getEventSettings(input.workspaceId);
  const alive = eligible && settings.enabled;

  if (!eligible) {
    return {
      eligible: false,
      enabled: settings.enabled,
      alive: false,
      delivered: false,
      event,
      reason:
        'Enable Messenger plus at least one other app, then turn on App events in the Dashboard.',
    };
  }

  if (!settings.enabled) {
    return {
      eligible: true,
      enabled: false,
      alive: false,
      delivered: false,
      event,
      reason:
        'App events are off. Enable them in Dashboard → App events to start sending.',
    };
  }

  if (!settings.deliverToMessengerEvents) {
    // Still run non-messenger Relay routes (webhook / email queue).
    const relay = await deliverEventViaRelay({
      workspaceId: input.workspaceId,
      userId: input.userId,
      event,
      allowMessenger: false,
    });
    const notification = await maybeRecordNotification(event, input.workspaceId);
    return {
      eligible: true,
      enabled: true,
      alive: true,
      delivered: Boolean(relay.message),
      event,
      notification,
      reason: 'Messenger #events delivery is paused; other Relay routes still apply.',
    };
  }

  const channel = await ensureEventsChannel(
    input.workspaceId,
    session.user.id,
  );

  const firstActivation = await activatedFile.update((activated) => {
    if (activated[input.workspaceId]) return false;
    activated[input.workspaceId] = true;
    return true;
  });
  if (firstActivation) {
    await postActivationMessage(input.workspaceId, channel.id);
  }

  const relay = await deliverEventViaRelay({
    workspaceId: input.workspaceId,
    userId: input.userId,
    event,
    allowMessenger: true,
  });

  const notification = await maybeRecordNotification(event, input.workspaceId);

  return {
    eligible: true,
    enabled: true,
    alive: true,
    delivered: relay.deliveredMessenger || Boolean(relay.message),
    event,
    notification,
    messageId: relay.message?.id,
    channelId: channel.id,
    reason: relay.reason,
  };
}

/** Enable/disable the feature flag; posts welcome message when turning on. */
export async function setEventsFeatureEnabled(input: {
  userId: string;
  workspaceId: string;
  enabled: boolean;
}): Promise<{
  settings: WorkspaceEventSettings;
  eligible: boolean;
  alive: boolean;
} | null> {
  const session = await resolveSession(input.userId, input.workspaceId);
  if (!session) return null;

  const eligible = isMessengerEventsEligible(session.workspace.selectedAppIds);
  const settings = await setEventSettings(input.workspaceId, {
    enabled: input.enabled,
  });

  if (input.enabled && eligible) {
    const channel = await ensureEventsChannel(
      input.workspaceId,
      session.user.id,
    );
    await activatedFile.update((activated) => {
      activated[input.workspaceId] = true;
    });
    await postActivationMessage(input.workspaceId, channel.id);
  }

  if (!input.enabled) {
    await activatedFile.update((activated) => {
      delete activated[input.workspaceId];
    });
  }

  return {
    settings,
    eligible,
    alive: eligible && settings.enabled,
  };
}

export async function getEventsStatus(userId: string, workspaceId: string) {
  const session = await resolveSession(userId, workspaceId);
  if (!session) return null;

  const eligible = isMessengerEventsEligible(session.workspace.selectedAppIds);
  const settings = await getEventSettings(workspaceId);
  return {
    eligible,
    enabled: settings.enabled,
    alive: eligible && settings.enabled,
    settings,
    eventsChannel: EVENTS_CHANNEL_NAME,
    selectedAppIds: session.workspace.selectedAppIds,
    selectedAppCount: session.workspace.selectedAppIds.length,
    hasMessenger: session.workspace.selectedAppIds.includes('messenger'),
  };
}
