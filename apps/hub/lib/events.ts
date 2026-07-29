import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import {
  DEFAULT_EVENT_SETTINGS,
  EVENTS_CHANNEL_NAME,
  SYSTEM_EVENTS_AUTHOR,
  formatEventMessageText,
  isMessengerEventsEligible,
  type HubSession,
  type WorkspaceEvent,
  type WorkspaceEventName,
  type WorkspaceEventPayload,
  type WorkspaceEventSettings,
} from '@sorye/types';
import { ensureEventsChannel, postSystemMessage } from '@/lib/store/messenger';
import { getHubSession, getHubSessionForWorkspace } from '@/lib/store';

const DATA_DIR = path.join(process.cwd(), '.data');
const SETTINGS_PATH = path.join(DATA_DIR, 'event-settings.json');
const ACTIVATED_PATH = path.join(DATA_DIR, 'event-activated.json');

type SettingsStore = Record<string, WorkspaceEventSettings>;
type ActivatedStore = Record<string, boolean>;

async function readSettings(): Promise<SettingsStore> {
  try {
    return JSON.parse(await readFile(SETTINGS_PATH, 'utf-8')) as SettingsStore;
  } catch {
    return {};
  }
}

async function writeSettings(data: SettingsStore) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

async function readActivated(): Promise<ActivatedStore> {
  try {
    return JSON.parse(await readFile(ACTIVATED_PATH, 'utf-8')) as ActivatedStore;
  } catch {
    return {};
  }
}

async function writeActivated(data: ActivatedStore) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(ACTIVATED_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

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
  const store = await readSettings();
  const next = normalizeSettings({
    ...store[workspaceId],
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  store[workspaceId] = next;
  await writeSettings(store);
  return next;
}

export interface PublishEventResult {
  eligible: boolean;
  enabled: boolean;
  alive: boolean;
  delivered: boolean;
  event: WorkspaceEvent;
  messageId?: string;
  channelId?: string;
  reason?: string;
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
    return {
      eligible: true,
      enabled: true,
      alive: true,
      delivered: false,
      event,
      reason: 'Messenger #events delivery is paused.',
    };
  }

  const channel = await ensureEventsChannel(
    input.workspaceId,
    session.user.id,
  );

  const activated = await readActivated();
  if (!activated[input.workspaceId]) {
    activated[input.workspaceId] = true;
    await writeActivated(activated);
    await postActivationMessage(input.workspaceId, channel.id);
  }

  const message = await postSystemMessage(
    input.workspaceId,
    channel.id,
    formatEventMessageText(event),
    { ...SYSTEM_EVENTS_AUTHOR },
  );

  return {
    eligible: true,
    enabled: true,
    alive: true,
    delivered: Boolean(message),
    event,
    messageId: message?.id,
    channelId: channel.id,
    reason: message ? undefined : 'Could not post to #events',
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
    const activated = await readActivated();
    activated[input.workspaceId] = true;
    await writeActivated(activated);
    await postActivationMessage(input.workspaceId, channel.id);
  }

  if (!input.enabled) {
    const activated = await readActivated();
    delete activated[input.workspaceId];
    await writeActivated(activated);
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
