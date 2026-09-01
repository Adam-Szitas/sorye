import {
  RELAY_CHANNEL_META,
  RELAY_SOURCES,
  createDefaultRelayConfig,
  type RelayChannel,
  type RelayChannelKind,
  type RelayConfig,
  type RelayDeliveryStatus,
  type RelayMessage,
  type RelayRoute,
} from '@sorye/types';

export type ChannelKind = RelayChannelKind;
export type DeliveryStatus = RelayDeliveryStatus;
export type WorkspaceSource = (typeof RELAY_SOURCES)[number];

export const WORKSPACE_SOURCES = RELAY_SOURCES;
export const CHANNEL_META = RELAY_CHANNEL_META;

export type {
  RelayChannel,
  RelayConfig,
  RelayMessage,
  RelayRoute,
};

/**
 * Client-side Relay handler — mutates config for Configure UI;
 * live deliveries happen on the Hub when apps emit workspace events.
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

  /** Replace activity feed from Hub without losing local edits. */
  withMessages(messages: RelayMessage[]): RelayHandler {
    return new RelayHandler({ ...this.config, messages });
  }

  withConfig(config: RelayConfig): RelayHandler {
    return new RelayHandler(config);
  }
}

export function createDefaultConfig(): RelayConfig {
  return createDefaultRelayConfig();
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
