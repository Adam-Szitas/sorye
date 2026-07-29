/** Workspace domain events — opt-in feature; default sink is Messenger #events. */

export const EVENTS_CHANNEL_NAME = 'events';

export const SYSTEM_EVENTS_AUTHOR = {
  id: 'sorye-events',
  name: 'Sorye Events',
} as const;

export type WorkspaceEventName =
  | 'sorye.system.events_activated'
  | 'sorye.task.created'
  | 'sorye.task.updated'
  | 'sorye.task.moved'
  | 'sorye.calendar.saved'
  | 'sorye.notes.saved'
  | 'sorye.test.ping';

export interface WorkspaceEventPayload {
  title: string;
  summary?: string;
  appId?: string;
  entityId?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface WorkspaceEvent {
  id: string;
  workspaceId: string;
  name: WorkspaceEventName;
  payload: WorkspaceEventPayload;
  actor?: { id: string; name: string };
  createdAt: string;
}

export interface WorkspaceEventSettings {
  /**
   * Feature flag: when false (default), apps may emit but nothing is delivered.
   * Turn on from Dashboard → App events.
   */
  enabled: boolean;
  /** When true, core movements post into Messenger #events (once enabled). */
  deliverToMessengerEvents: boolean;
  updatedAt?: string;
}

export const DEFAULT_EVENT_SETTINGS: WorkspaceEventSettings = {
  enabled: false,
  deliverToMessengerEvents: true,
};

/**
 * Prerequisites for the events feature: Messenger enabled plus at least one
 * other app (2+ apps total).
 */
export function isMessengerEventsEligible(selectedAppIds: string[]): boolean {
  const unique = new Set(selectedAppIds);
  return unique.has('messenger') && unique.size >= 2;
}

/** @deprecated Use isMessengerEventsEligible — kept for gradual migration */
export function isMessengerEventsAlive(selectedAppIds: string[]): boolean {
  return isMessengerEventsEligible(selectedAppIds);
}

export function formatEventMessageText(event: {
  name: WorkspaceEventName | string;
  payload: WorkspaceEventPayload;
}): string {
  const lines = [
    `**${event.payload.title}**`,
    event.payload.summary?.trim() || null,
    `\`${event.name}\``,
  ].filter(Boolean);
  return lines.join('\n');
}
