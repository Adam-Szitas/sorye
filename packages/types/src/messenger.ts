export type MessengerMessageKind = 'text' | 'image';

export type MessengerChannelKind = 'channel' | 'dm';

export interface MessengerAuthor {
  id: string;
  name: string;
  image?: string;
}

export interface MessengerMember {
  id: string;
  displayName: string;
  email: string;
  image?: string;
}

export interface MessengerMessage {
  id: string;
  channelId: string;
  workspaceId: string;
  kind: MessengerMessageKind;
  text?: string;
  imageDataUrl?: string;
  imageBytes?: number;
  imageWidth?: number;
  imageHeight?: number;
  author: MessengerAuthor;
  createdAt: string;
}

export interface MessengerChannel {
  id: string;
  workspaceId: string;
  kind: MessengerChannelKind;
  /** Display name for channels; for DMs derived from the other user. */
  name: string;
  /** All members for DMs (exactly 2). Empty/unused for public channels. */
  memberIds: string[];
  createdAt: string;
  createdBy: string;
}

export interface MessengerBootstrap {
  workspace: { id: string; kind: string; name: string };
  user: MessengerAuthor;
  members: MessengerMember[];
  channels: MessengerChannel[];
  messages: MessengerMessage[];
  events?: {
    /** Messenger + ≥1 other app installed. */
    eligible: boolean;
    /** User opted in via Dashboard → App events. */
    enabled: boolean;
    /** eligible && enabled — pipeline is actively delivering. */
    alive: boolean;
    deliverToMessengerEvents: boolean;
    eventsChannel: string;
  };
}

export function dmChannelId(userA: string, userB: string): string {
  const [a, b] = [userA, userB].sort();
  return `dm-${a}-${b}`;
}
