export type ChannelKind = 'email' | 'whatsapp' | 'webhook';

export type DeliveryStatus = 'queued' | 'sent' | 'skipped' | 'failed';

export interface WorkspaceSource {
  id: string;
  name: string;
}

export const WORKSPACE_SOURCES: WorkspaceSource[] = [
  { id: 'dashboard', name: 'Dashboard' },
  { id: 'calendar', name: 'Calendar' },
  { id: 'notes', name: 'Notes' },
  { id: 'tasks', name: 'Tasks' },
];

export interface RelayChannel {
  id: string;
  kind: ChannelKind;
  label: string;
  enabled: boolean;
  destination: string;
}

export interface RelayRoute {
  id: string;
  sourceAppId: string;
  channelId: string;
  enabled: boolean;
}

export interface DeliveryRecord {
  channelId: string;
  channelKind: ChannelKind;
  status: DeliveryStatus;
  detail: string;
  sentAt?: string;
}

export interface RelayMessage {
  id: string;
  sourceAppId: string;
  title: string;
  body: string;
  createdAt: string;
  deliveries: DeliveryRecord[];
}

export interface RelayConfig {
  sources: Record<string, boolean>;
  channels: RelayChannel[];
  routes: RelayRoute[];
  messages: RelayMessage[];
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export const CHANNEL_META: Record<
  ChannelKind,
  { label: string; placeholder: string; hint: string }
> = {
  email: {
    label: 'Email',
    placeholder: 'you@company.com',
    hint: 'SMTP/API wiring lands on the hub backend later.',
  },
  whatsapp: {
    label: 'WhatsApp',
    placeholder: '+1 555 0100',
    hint: 'Uses WhatsApp Business API when connected.',
  },
  webhook: {
    label: 'Webhook',
    placeholder: 'https://hooks.example.com/relay',
    hint: 'POST JSON payloads to your automation stack.',
  },
};

function deliveryDetail(
  channel: RelayChannel,
  status: DeliveryStatus,
): string {
  if (status === 'skipped') return 'Channel disabled or missing destination';
  if (status === 'failed') return 'Delivery failed (simulated)';
  const dest = channel.destination.trim() || '(not configured)';
  if (channel.kind === 'email') return `Simulated email to ${dest}`;
  if (channel.kind === 'whatsapp') return `Simulated WhatsApp to ${dest}`;
  return `Simulated webhook POST to ${dest}`;
}

function isWithinQuietHours(config: RelayConfig, at: Date): boolean {
  if (!config.quietHoursEnabled) return false;
  const [sh, sm] = config.quietHoursStart.split(':').map(Number);
  const [eh, em] = config.quietHoursEnd.split(':').map(Number);
  const minutes = at.getHours() * 60 + at.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  if (start === end) return false;
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end;
}

/**
 * Routes workspace app messages to configured delivery channels.
 */
export class RelayHandler {
  constructor(private readonly config: RelayConfig) {}

  getConfig(): RelayConfig {
    return this.config;
  }

  isSourceEnabled(appId: string): boolean {
    return this.config.sources[appId] ?? false;
  }

  getChannels(): RelayChannel[] {
    return this.config.channels;
  }

  getRoutes(): RelayRoute[] {
    return this.config.routes;
  }

  getMessages(): RelayMessage[] {
    return [...this.config.messages].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  toggleSource(appId: string, enabled: boolean): RelayHandler {
    return new RelayHandler({
      ...this.config,
      sources: { ...this.config.sources, [appId]: enabled },
    });
  }

  updateChannel(
    channelId: string,
    patch: Partial<Pick<RelayChannel, 'label' | 'enabled' | 'destination'>>,
  ): RelayHandler {
    return new RelayHandler({
      ...this.config,
      channels: this.config.channels.map((channel) =>
        channel.id === channelId ? { ...channel, ...patch } : channel,
      ),
    });
  }

  toggleRoute(routeId: string, enabled: boolean): RelayHandler {
    return new RelayHandler({
      ...this.config,
      routes: this.config.routes.map((route) =>
        route.id === routeId ? { ...route, enabled } : route,
      ),
    });
  }

  addRoute(sourceAppId: string, channelId: string): RelayHandler {
    const exists = this.config.routes.some(
      (route) =>
        route.sourceAppId === sourceAppId && route.channelId === channelId,
    );
    if (exists) return this;

    const route: RelayRoute = {
      id: `route-${crypto.randomUUID().slice(0, 8)}`,
      sourceAppId,
      channelId,
      enabled: true,
    };

    return new RelayHandler({
      ...this.config,
      routes: [...this.config.routes, route],
    });
  }

  removeRoute(routeId: string): RelayHandler {
    return new RelayHandler({
      ...this.config,
      routes: this.config.routes.filter((route) => route.id !== routeId),
    });
  }

  updatePreferences(
    patch: Partial<
      Pick<
        RelayConfig,
        'quietHoursEnabled' | 'quietHoursStart' | 'quietHoursEnd'
      >
    >,
  ): RelayHandler {
    return new RelayHandler({ ...this.config, ...patch });
  }

  ingestMessage(
    sourceAppId: string,
    title: string,
    body: string,
  ): RelayHandler {
    if (!this.isSourceEnabled(sourceAppId)) return this;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) return this;

    const now = new Date();
    const quiet = isWithinQuietHours(this.config, now);
    const matchingRoutes = this.config.routes.filter(
      (route) => route.enabled && route.sourceAppId === sourceAppId,
    );

    const deliveries: DeliveryRecord[] = [];
    const sentAt = now.toISOString();

    for (const route of matchingRoutes) {
      const channel = this.config.channels.find((c) => c.id === route.channelId);
      if (!channel) continue;

      let status: DeliveryStatus = 'queued';
      if (!channel.enabled || !channel.destination.trim()) {
        status = 'skipped';
      } else if (quiet) {
        status = 'queued';
      } else {
        status = 'sent';
      }

      deliveries.push({
        channelId: channel.id,
        channelKind: channel.kind,
        status,
        detail: quiet && status === 'queued'
          ? `Queued during quiet hours (${this.config.quietHoursStart}–${this.config.quietHoursEnd})`
          : deliveryDetail(channel, status),
        sentAt: status === 'sent' ? sentAt : undefined,
      });
    }

    if (deliveries.length === 0) return this;

    const message: RelayMessage = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      sourceAppId,
      title: trimmedTitle,
      body: body.trim(),
      createdAt: sentAt,
      deliveries,
    };

    return new RelayHandler({
      ...this.config,
      messages: [message, ...this.config.messages].slice(0, 100),
    });
  }

  sendTestMessage(sourceAppId: string): RelayHandler {
    return this.ingestMessage(
      sourceAppId,
      'Relay test notification',
      'This is a simulated message from your workspace app. Wire real events when backend connectors are ready.',
    );
  }
}

export function createDefaultConfig(): RelayConfig {
  const channels: RelayChannel[] = [
    {
      id: 'channel-email',
      kind: 'email',
      label: 'Primary email',
      enabled: true,
      destination: '',
    },
    {
      id: 'channel-whatsapp',
      kind: 'whatsapp',
      label: 'WhatsApp',
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
  ];

  const sources = Object.fromEntries(
    WORKSPACE_SOURCES.map((source) => [source.id, true]),
  ) as Record<string, boolean>;

  const routes: RelayRoute[] = WORKSPACE_SOURCES.flatMap((source, index) => [
    {
      id: `route-${source.id}-email`,
      sourceAppId: source.id,
      channelId: 'channel-email',
      enabled: true,
    },
    {
      id: `route-${source.id}-whatsapp`,
      sourceAppId: source.id,
      channelId: 'channel-whatsapp',
      enabled: index === 0,
    },
  ]);

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

export function sourceLabel(appId: string): string {
  return WORKSPACE_SOURCES.find((s) => s.id === appId)?.name ?? appId;
}

export function channelLabel(
  channels: RelayChannel[],
  channelId: string,
): string {
  const channel = channels.find((c) => c.id === channelId);
  return channel?.label ?? channelId;
}
