import {
  RELAY_BROADCAST_CHANNEL,
  createDefaultRelayConfig,
  type RelayBroadcastMessage,
  type RelayConfig,
} from '@sorye/types';

const STORAGE_KEY = 'sorye:relay:config';

function isChannel(value: unknown): value is RelayConfig['channels'][number] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.kind === 'string' &&
    typeof record.label === 'string' &&
    typeof record.enabled === 'boolean' &&
    typeof record.destination === 'string'
  );
}

function isRoute(value: unknown): value is RelayConfig['routes'][number] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.sourceAppId === 'string' &&
    typeof record.channelId === 'string' &&
    typeof record.enabled === 'boolean'
  );
}

function isMessage(value: unknown): value is RelayConfig['messages'][number] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.sourceAppId === 'string' &&
    typeof record.title === 'string' &&
    typeof record.body === 'string' &&
    typeof record.createdAt === 'string' &&
    Array.isArray(record.deliveries)
  );
}

function normalizeConfig(raw: unknown): RelayConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.channels) || !Array.isArray(record.routes)) {
    return null;
  }

  const channels = record.channels.filter(isChannel);
  const routes = record.routes.filter(isRoute);
  const messages = Array.isArray(record.messages)
    ? record.messages.filter(isMessage)
    : [];

  if (channels.length === 0) return null;

  const defaults = createDefaultRelayConfig();
  const sources =
    record.sources && typeof record.sources === 'object'
      ? { ...defaults.sources, ...(record.sources as Record<string, boolean>) }
      : defaults.sources;

  // Upgrade older configs that lack the Messenger channel.
  const hasMessenger = channels.some((c) => c.kind === 'messenger');
  const mergedChannels = hasMessenger
    ? channels
    : [defaults.channels[0]!, ...channels];

  const knownSources = new Set(Object.keys(defaults.sources));
  for (const source of Object.keys(defaults.sources)) {
    if (sources[source] === undefined) sources[source] = true;
  }

  let mergedRoutes = routes;
  if (!hasMessenger) {
    const messengerRoutes = [...knownSources].map((sourceAppId) => ({
      id: `route-${sourceAppId}-messenger`,
      sourceAppId,
      channelId: 'channel-messenger',
      enabled: true,
    }));
    mergedRoutes = [...messengerRoutes, ...routes];
  }

  return {
    sources,
    channels: mergedChannels,
    routes: mergedRoutes,
    messages,
    quietHoursEnabled:
      typeof record.quietHoursEnabled === 'boolean'
        ? record.quietHoursEnabled
        : defaults.quietHoursEnabled,
    quietHoursStart:
      typeof record.quietHoursStart === 'string'
        ? record.quietHoursStart
        : defaults.quietHoursStart,
    quietHoursEnd:
      typeof record.quietHoursEnd === 'string'
        ? record.quietHoursEnd
        : defaults.quietHoursEnd,
    updatedAt:
      typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
  };
}

export function loadConfig(): RelayConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultRelayConfig();
    return normalizeConfig(JSON.parse(raw) as unknown) ?? createDefaultRelayConfig();
  } catch {
    return createDefaultRelayConfig();
  }
}

export function saveConfig(config: RelayConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export interface RelayApiSnapshot {
  config: RelayConfig;
  eventsEnabled: boolean;
  deliverToMessengerEvents: boolean;
}

export async function fetchRelayConfig(): Promise<RelayApiSnapshot | null> {
  try {
    const res = await fetch('/api/relay', { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as RelayApiSnapshot;
  } catch {
    return null;
  }
}

export async function persistRelayConfig(
  config: RelayConfig,
): Promise<RelayConfig | null> {
  try {
    const res = await fetch('/api/relay', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sources: config.sources,
        channels: config.channels,
        routes: config.routes,
        quietHoursEnabled: config.quietHoursEnabled,
        quietHoursStart: config.quietHoursStart,
        quietHoursEnd: config.quietHoursEnd,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { config: RelayConfig };
    saveConfig(data.config);
    broadcastRelayUpdated();
    return data.config;
  } catch {
    return null;
  }
}

export async function sendRelayTest(
  sourceAppId: string,
): Promise<RelayApiSnapshot & { reason?: string } | null> {
  try {
    const res = await fetch('/api/relay', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test', sourceAppId }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RelayApiSnapshot & { reason?: string };
    if (data.config) saveConfig(data.config);
    broadcastRelayUpdated();
    return data;
  } catch {
    return null;
  }
}

export function broadcastRelayUpdated() {
  try {
    const channel = new BroadcastChannel(RELAY_BROADCAST_CHANNEL);
    const message: RelayBroadcastMessage = { type: 'relay-updated' };
    channel.postMessage(message);
    channel.close();
  } catch {
    // ignore
  }
}

export function subscribeRelayUpdates(onUpdate: () => void): () => void {
  try {
    const channel = new BroadcastChannel(RELAY_BROADCAST_CHANNEL);
    channel.onmessage = () => onUpdate();
    return () => channel.close();
  } catch {
    return () => undefined;
  }
}
