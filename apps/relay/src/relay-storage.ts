import {
  createDefaultConfig,
  type RelayConfig,
} from './relay-handler';

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

  const defaults = createDefaultConfig();
  const sources =
    record.sources && typeof record.sources === 'object'
      ? { ...defaults.sources, ...(record.sources as Record<string, boolean>) }
      : defaults.sources;

  return {
    sources,
    channels,
    routes,
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
  };
}

export function loadConfig(): RelayConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultConfig();
    return normalizeConfig(JSON.parse(raw) as unknown) ?? createDefaultConfig();
  } catch {
    return createDefaultConfig();
  }
}

export function saveConfig(config: RelayConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
