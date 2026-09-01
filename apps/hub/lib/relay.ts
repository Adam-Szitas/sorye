import { randomUUID } from 'crypto';
import {
  EVENTS_CHANNEL_NAME,
  SYSTEM_EVENTS_AUTHOR,
  createDefaultRelayConfig,
  formatEventMessageText,
  relaySourceFromEventName,
  type RelayChannel,
  type RelayConfig,
  type RelayDeliveryRecord,
  type RelayDeliveryStatus,
  type RelayMessage,
  type WorkspaceEvent,
} from '@sorye/types';
import { assertSafeWebhookUrl } from '@/lib/security';
import { jsonDataFile } from '@/lib/store/json-file';
import { ensureEventsChannel, postSystemMessage } from '@/lib/store/messenger';

type RelayStore = Record<string, RelayConfig>;

const relayFile = jsonDataFile<RelayStore>('relay.json', () => ({}));

const readStore = () => relayFile.read();

function isWithinQuietHours(config: RelayConfig, at: Date): boolean {
  if (!config.quietHoursEnabled) return false;
  const [sh, sm] = config.quietHoursStart.split(':').map(Number);
  const [eh, em] = config.quietHoursEnd.split(':').map(Number);
  const minutes = at.getHours() * 60 + at.getMinutes();
  const start = (sh ?? 0) * 60 + (sm ?? 0);
  const end = (eh ?? 0) * 60 + (em ?? 0);
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

function normalizeConfig(raw: Partial<RelayConfig> | undefined): RelayConfig {
  const defaults = createDefaultRelayConfig();
  if (!raw) return defaults;

  const channels =
    Array.isArray(raw.channels) && raw.channels.length > 0
      ? mergeChannels(defaults.channels, raw.channels)
      : defaults.channels;

  const sources = { ...defaults.sources, ...(raw.sources ?? {}) };
  const knownSourceIds = new Set(Object.keys(defaults.sources));
  for (const id of Object.keys(sources)) {
    if (!knownSourceIds.has(id) && id !== 'notes' && id !== 'dashboard') {
      // keep unknown toggles for forward-compat
    }
  }

  const routes =
    Array.isArray(raw.routes) && raw.routes.length > 0
      ? raw.routes
      : defaults.routes;

  return {
    sources,
    channels,
    routes,
    messages: Array.isArray(raw.messages) ? raw.messages.slice(0, 100) : [],
    quietHoursEnabled: raw.quietHoursEnabled === true,
    quietHoursStart:
      typeof raw.quietHoursStart === 'string'
        ? raw.quietHoursStart
        : defaults.quietHoursStart,
    quietHoursEnd:
      typeof raw.quietHoursEnd === 'string'
        ? raw.quietHoursEnd
        : defaults.quietHoursEnd,
    updatedAt: raw.updatedAt,
  };
}

function mergeChannels(
  defaults: RelayChannel[],
  saved: RelayChannel[],
): RelayChannel[] {
  const byId = new Map(saved.map((c) => [c.id, c]));
  const merged = defaults.map((def) => {
    const existing = byId.get(def.id);
    if (!existing) return def;
    byId.delete(def.id);
    return { ...def, ...existing, kind: existing.kind ?? def.kind };
  });
  for (const leftover of byId.values()) merged.push(leftover);
  // Ensure messenger channel always exists.
  if (!merged.some((c) => c.kind === 'messenger')) {
    merged.unshift(defaults.find((c) => c.kind === 'messenger')!);
  }
  return merged;
}

export async function getRelayConfig(workspaceId: string): Promise<RelayConfig> {
  const snapshot = await readStore();
  if (snapshot[workspaceId]) {
    return normalizeConfig(snapshot[workspaceId]);
  }
  return relayFile.update((store) => {
    const normalized = normalizeConfig(store[workspaceId]);
    store[workspaceId] = normalized;
    return normalized;
  });
}

function sanitizeChannels(channels: RelayChannel[]): RelayChannel[] {
  return channels.map((channel) => {
    if (channel.kind !== 'webhook' || !channel.destination.trim()) {
      return channel;
    }
    return {
      ...channel,
      destination: assertSafeWebhookUrl(channel.destination),
    };
  });
}

export async function setRelayConfig(
  workspaceId: string,
  patch: Partial<
    Pick<
      RelayConfig,
      | 'sources'
      | 'channels'
      | 'routes'
      | 'quietHoursEnabled'
      | 'quietHoursStart'
      | 'quietHoursEnd'
    >
  >,
): Promise<RelayConfig> {
  const patchChannels = patch.channels
    ? sanitizeChannels(patch.channels)
    : undefined;
  return relayFile.update((store) => {
    const current = normalizeConfig(store[workspaceId]);
    const next = normalizeConfig({
      ...current,
      ...patch,
      ...(patchChannels ? { channels: patchChannels } : {}),
      messages: current.messages,
      updatedAt: new Date().toISOString(),
    });
    store[workspaceId] = next;
    return next;
  });
}

async function appendRelayMessage(
  workspaceId: string,
  message: RelayMessage,
): Promise<RelayConfig> {
  return relayFile.update((store) => {
    const current = normalizeConfig(store[workspaceId]);
    const next: RelayConfig = {
      ...current,
      messages: [message, ...current.messages].slice(0, 100),
      updatedAt: new Date().toISOString(),
    };
    store[workspaceId] = next;
    return next;
  });
}

function deliveryDetail(
  channel: RelayChannel,
  status: RelayDeliveryStatus,
  extra?: string,
): string {
  if (extra) return extra;
  if (status === 'skipped') return 'Channel disabled or missing destination';
  if (status === 'failed') return 'Delivery failed';
  const dest = channel.destination.trim() || '(not configured)';
  if (channel.kind === 'messenger') return `Posted to Messenger #${dest}`;
  if (channel.kind === 'email') return `Queued email to ${dest}`;
  if (channel.kind === 'whatsapp') return `Queued WhatsApp to ${dest}`;
  return `Webhook POST to ${dest}`;
}

async function deliverWebhook(
  channel: RelayChannel,
  event: WorkspaceEvent,
): Promise<{ status: RelayDeliveryStatus; detail: string }> {
  const raw = channel.destination.trim();
  if (!raw) return { status: 'skipped', detail: 'Missing webhook URL' };

  let url: string;
  try {
    url = assertSafeWebhookUrl(raw);
  } catch (err) {
    return {
      status: 'failed',
      detail:
        err instanceof Error ? err.message : 'Webhook URL rejected for security',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'sorye-relay',
        event: {
          id: event.id,
          name: event.name,
          workspaceId: event.workspaceId,
          payload: event.payload,
          createdAt: event.createdAt,
        },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        status: 'failed',
        detail: `Webhook responded ${res.status}`,
      };
    }
    return {
      status: 'sent',
      detail: `Webhook POST ${res.status} → ${url}`,
    };
  } catch (err) {
    return {
      status: 'failed',
      detail:
        err instanceof Error ? `Webhook error: ${err.message}` : 'Webhook error',
    };
  }
}

async function deliverMessenger(
  workspaceId: string,
  userId: string,
  channel: RelayChannel,
  event: WorkspaceEvent,
): Promise<{ status: RelayDeliveryStatus; detail: string; messageId?: string }> {
  const name = (channel.destination.trim() || EVENTS_CHANNEL_NAME).replace(
    /^#/,
    '',
  );
  const eventsChannel = await ensureEventsChannel(workspaceId, userId);
  // Today ensureEventsChannel always creates/returns #events; destination is documented.
  void name;
  const posted = await postSystemMessage(
    workspaceId,
    eventsChannel.id,
    formatEventMessageText(event),
    { ...SYSTEM_EVENTS_AUTHOR },
  );
  if (!posted) {
    return { status: 'failed', detail: 'Could not post to Messenger #events' };
  }
  return {
    status: 'sent',
    detail: `Posted to Messenger #${EVENTS_CHANNEL_NAME}`,
    messageId: posted.id,
  };
}

export interface RelayDeliverResult {
  deliveredMessenger: boolean;
  message?: RelayMessage;
  reason?: string;
}

/**
 * Apply workspace Relay routes for a published event.
 * Messenger posts are real; webhooks fire when a URL is set; email/WhatsApp queue.
 */
export async function deliverEventViaRelay(input: {
  workspaceId: string;
  userId: string;
  event: WorkspaceEvent;
  allowMessenger: boolean;
}): Promise<RelayDeliverResult> {
  const sourceAppId =
    (input.event.payload.appId &&
    typeof input.event.payload.appId === 'string'
      ? input.event.payload.appId
      : null) ?? relaySourceFromEventName(input.event.name);

  if (!sourceAppId) {
    return { deliveredMessenger: false, reason: 'No Relay source for event' };
  }

  const config = await getRelayConfig(input.workspaceId);
  if (config.sources[sourceAppId] === false) {
    return {
      deliveredMessenger: false,
      reason: `Relay source "${sourceAppId}" is disabled`,
    };
  }

  const matchingRoutes = config.routes.filter(
    (route) => route.enabled && route.sourceAppId === sourceAppId,
  );
  if (matchingRoutes.length === 0) {
    return {
      deliveredMessenger: false,
      reason: `No Relay routes for "${sourceAppId}"`,
    };
  }

  const now = new Date();
  const quiet = isWithinQuietHours(config, now);
  const sentAt = now.toISOString();
  const deliveries: RelayDeliveryRecord[] = [];
  let deliveredMessenger = false;

  for (const route of matchingRoutes) {
    const channel = config.channels.find((c) => c.id === route.channelId);
    if (!channel) continue;

    if (!channel.enabled) {
      deliveries.push({
        channelId: channel.id,
        channelKind: channel.kind,
        status: 'skipped',
        detail: deliveryDetail(channel, 'skipped'),
      });
      continue;
    }

    if (channel.kind === 'messenger' && !input.allowMessenger) {
      deliveries.push({
        channelId: channel.id,
        channelKind: channel.kind,
        status: 'skipped',
        detail: 'Messenger #events delivery is paused in App events settings',
      });
      continue;
    }

    if (quiet && channel.kind !== 'messenger') {
      deliveries.push({
        channelId: channel.id,
        channelKind: channel.kind,
        status: 'queued',
        detail: `Queued during quiet hours (${config.quietHoursStart}–${config.quietHoursEnd})`,
      });
      continue;
    }

    if (channel.kind === 'messenger') {
      const result = await deliverMessenger(
        input.workspaceId,
        input.userId,
        channel,
        input.event,
      );
      deliveries.push({
        channelId: channel.id,
        channelKind: channel.kind,
        status: result.status,
        detail: result.detail,
        sentAt: result.status === 'sent' ? sentAt : undefined,
      });
      if (result.status === 'sent') deliveredMessenger = true;
      continue;
    }

    if (channel.kind === 'webhook') {
      if (quiet) {
        deliveries.push({
          channelId: channel.id,
          channelKind: channel.kind,
          status: 'queued',
          detail: `Queued during quiet hours (${config.quietHoursStart}–${config.quietHoursEnd})`,
        });
        continue;
      }
      const result = await deliverWebhook(channel, input.event);
      deliveries.push({
        channelId: channel.id,
        channelKind: channel.kind,
        status: result.status,
        detail: result.detail,
        sentAt: result.status === 'sent' ? sentAt : undefined,
      });
      continue;
    }

    // email / whatsapp — store intent until connectors land
    const dest = channel.destination.trim();
    if (!dest) {
      deliveries.push({
        channelId: channel.id,
        channelKind: channel.kind,
        status: 'skipped',
        detail: deliveryDetail(channel, 'skipped'),
      });
      continue;
    }
    deliveries.push({
      channelId: channel.id,
      channelKind: channel.kind,
      status: 'queued',
      detail: deliveryDetail(channel, 'queued'),
    });
  }

  if (deliveries.length === 0) {
    return {
      deliveredMessenger: false,
      reason: 'No matching Relay channels',
    };
  }

  const message: RelayMessage = {
    id: `msg-${randomUUID().slice(0, 8)}`,
    sourceAppId,
    title: input.event.payload.title,
    body: input.event.payload.summary?.trim() ?? '',
    eventName: input.event.name,
    createdAt: sentAt,
    deliveries,
  };

  await appendRelayMessage(input.workspaceId, message);

  return { deliveredMessenger, message };
}

/** Manual / test ingest without a workspace event (still logs activity). */
export async function ingestRelayTestMessage(input: {
  workspaceId: string;
  userId: string;
  sourceAppId: string;
  title: string;
  body: string;
  allowMessenger: boolean;
}): Promise<RelayDeliverResult> {
  const event: WorkspaceEvent = {
    id: `evt-${randomUUID().slice(0, 10)}`,
    workspaceId: input.workspaceId,
    name: 'sorye.test.ping',
    payload: {
      title: input.title,
      summary: input.body,
      appId: input.sourceAppId,
    },
    createdAt: new Date().toISOString(),
  };
  return deliverEventViaRelay({
    workspaceId: input.workspaceId,
    userId: input.userId,
    event,
    allowMessenger: input.allowMessenger,
  });
}
