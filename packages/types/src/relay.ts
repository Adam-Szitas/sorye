/** Relay — route workspace app movements to Messenger, email, webhooks, etc. */

export const RELAY_BROADCAST_CHANNEL = 'sorye-relay';

export type RelayChannelKind = 'messenger' | 'email' | 'whatsapp' | 'webhook';

export type RelayDeliveryStatus = 'queued' | 'sent' | 'skipped' | 'failed';

export interface RelaySource {
  id: string;
  name: string;
  /** Short hint shown in the Configure UI. */
  description: string;
}

/** Primary apps users wire together in Relay. */
export const RELAY_SOURCES: readonly RelaySource[] = [
  {
    id: 'ocr',
    name: 'OCR',
    description: 'Scan finished or layout ready for Protocolio.',
  },
  {
    id: 'protocolio',
    name: 'Protocolio',
    description: 'PDF generated from a template or OCR handoff.',
  },
  {
    id: 'messenger',
    name: 'Messenger',
    description: 'Workspace chat activity (optional routing).',
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Events added or removed.',
  },
  {
    id: 'tasks',
    name: 'Tasks',
    description: 'Tasks created, updated, or moved.',
  },
  {
    id: 'studio',
    name: 'Studio',
    description: '3D model opened or shut down by the Too-much monitor.',
  },
] as const;

export interface RelayChannel {
  id: string;
  kind: RelayChannelKind;
  label: string;
  enabled: boolean;
  /** Email address, phone, webhook URL, or Messenger channel name (e.g. events). */
  destination: string;
}

export interface RelayRoute {
  id: string;
  sourceAppId: string;
  channelId: string;
  enabled: boolean;
}

export interface RelayDeliveryRecord {
  channelId: string;
  channelKind: RelayChannelKind;
  status: RelayDeliveryStatus;
  detail: string;
  sentAt?: string;
}

export interface RelayMessage {
  id: string;
  sourceAppId: string;
  title: string;
  body: string;
  eventName?: string;
  createdAt: string;
  deliveries: RelayDeliveryRecord[];
}

export interface RelayConfig {
  sources: Record<string, boolean>;
  channels: RelayChannel[];
  routes: RelayRoute[];
  messages: RelayMessage[];
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  updatedAt?: string;
}

export const RELAY_CHANNEL_META: Record<
  RelayChannelKind,
  { label: string; placeholder: string; hint: string }
> = {
  messenger: {
    label: 'Messenger',
    placeholder: 'events',
    hint: 'Posts into a Messenger channel (default #events). Requires App events on.',
  },
  email: {
    label: 'Email',
    placeholder: 'you@company.com',
    hint: 'Queued locally until Hub SMTP is connected; destination is stored for when it is.',
  },
  whatsapp: {
    label: 'WhatsApp',
    placeholder: '+1 555 0100',
    hint: 'Queued until WhatsApp Business is connected.',
  },
  webhook: {
    label: 'Webhook',
    placeholder: 'https://hooks.example.com/relay',
    hint: 'POSTs JSON to your automation URL when a routed event fires.',
  },
};

export interface RelayBroadcastMessage {
  type: 'relay-updated' | 'relay-message';
  workspaceId?: string;
}

/** Map workspace event names → Relay source app ids. */
export function relaySourceFromEventName(name: string): string | null {
  if (name.startsWith('sorye.ocr.')) return 'ocr';
  if (name.startsWith('sorye.protocolio.')) return 'protocolio';
  if (name.startsWith('sorye.messenger.')) return 'messenger';
  if (name.startsWith('sorye.calendar.')) return 'calendar';
  if (name.startsWith('sorye.task.')) return 'tasks';
  if (name.startsWith('sorye.notes.')) return 'notes';
  if (name.startsWith('sorye.studio.')) return 'studio';
  if (name === 'sorye.test.ping') return 'messenger';
  return null;
}

export function createDefaultRelayConfig(): RelayConfig {
  const channels: RelayChannel[] = [
    {
      id: 'channel-messenger',
      kind: 'messenger',
      label: 'Messenger #events',
      enabled: true,
      destination: 'events',
    },
    {
      id: 'channel-email',
      kind: 'email',
      label: 'Primary email',
      enabled: false,
      destination: '',
    },
    {
      id: 'channel-webhook',
      kind: 'webhook',
      label: 'Automation webhook',
      enabled: false,
      destination: '',
    },
    {
      id: 'channel-whatsapp',
      kind: 'whatsapp',
      label: 'WhatsApp',
      enabled: false,
      destination: '',
    },
  ];

  const sources = Object.fromEntries(
    RELAY_SOURCES.map((source) => [source.id, true]),
  ) as Record<string, boolean>;

  const routes: RelayRoute[] = RELAY_SOURCES.map((source) => ({
    id: `route-${source.id}-messenger`,
    sourceAppId: source.id,
    channelId: 'channel-messenger',
    enabled: true,
  }));

  return {
    sources,
    channels,
    routes,
    messages: [],
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
  };
}
