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

/** A person pinged in a message. The id is the payload; the text token is the visible name. */
export interface MessengerMention {
  userId: string;
  name: string;
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
  /** Present when the text contains validated `@[Name](userId)` pings. */
  mentions?: MessengerMention[];
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

/** Default window for a thread (most recent first, then older on scroll-up). */
export const MESSENGER_PAGE_SIZE = 30;
/** Server-side cap for `GET /api/messenger/messages?limit=`. */
export const MESSENGER_PAGE_SIZE_MAX = 50;

export interface MessengerMessagesPage {
  messages: MessengerMessage[];
  /**
   * Without `after`: more older messages exist.
   * With `after`: more newer messages exist beyond this page.
   */
  hasMore: boolean;
}

export interface MessengerBootstrap {
  workspace: { id: string; kind: string; name: string };
  user: MessengerAuthor;
  members: MessengerMember[];
  channels: MessengerChannel[];
  /** Hub bootstrap omits history (`[]`); load pages from `/api/messenger/messages`. */
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
  /** Channels the user joined or was invited to, split by workspace kind. */
  load?: import('./user-load').UserLoadPartition<MessengerChannel>;
}

export function dmChannelId(userA: string, userB: string): string {
  const [a, b] = [userA, userB].sort();
  return `dm-${a}-${b}`;
}

const MENTION_TOKEN =
  /@\[([^\]\r\n]{1,80})\]\(([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\)/g;

export function mentionToken(name: string, userId: string): string {
  const safe = name.replace(/[\[\]]/g, '').trim().slice(0, 80);
  return `@[${safe}](${userId})`;
}

export function mentionsFromText(text: string): MessengerMention[] {
  const mentions: MessengerMention[] = [];
  for (const match of text.matchAll(MENTION_TOKEN)) {
    mentions.push({ name: match[1], userId: match[2] });
  }
  return mentions;
}

export function withMessengerMentions<T extends { text?: string; mentions?: MessengerMention[] }>(
  message: T,
): T {
  if (!message.text) return message;
  const mentions = mentionsFromText(message.text);
  if (mentions.length === 0) return message;
  return { ...message, mentions };
}

/**
 * Personal-channel pings require Messenger in the recipient's personal package.
 * A team channel does not consult that package.
 */
export function allowMessengerPing(
  workspaceKind: string,
  recipientPackageIncludesMessenger: boolean,
): boolean {
  if (workspaceKind !== 'personal') return true;
  return recipientPackageIncludesMessenger;
}

export interface MentionCandidate {
  id: string;
  displayName: string;
}

/** People the composer may offer. `members` must already be that channel's workspace. */
export function mentionSuggestions<T extends MentionCandidate>(input: {
  members: readonly T[];
  channelMemberIds: readonly string[];
  channelKind: string;
  selfId: string;
  query: string;
  allowed?: (userId: string) => boolean;
}): T[] {
  const query = input.query.trim().toLowerCase();
  if (!query) return [];
  const restricted = input.channelKind === 'dm' || input.channelMemberIds.length > 0;
  const visible = new Set(input.channelMemberIds);
  return input.members.filter((member) => {
    if (member.id === input.selfId) return false;
    if (restricted && !visible.has(member.id)) return false;
    if (input.allowed && !input.allowed(member.id)) return false;
    return member.displayName.toLowerCase().includes(query);
  });
}

/** Ids that survive workspace membership, channel visibility, and the package gate. */
export function pingsToNotify(input: {
  requestedIds: readonly string[];
  members: readonly MentionCandidate[];
  channelMemberIds: readonly string[];
  channelKind: string;
  authorId: string;
  allowed?: (userId: string) => boolean;
}): string[] {
  const restricted = input.channelKind === 'dm' || input.channelMemberIds.length > 0;
  const members = new Set(input.members.map((member) => member.id));
  const visible = new Set(input.channelMemberIds);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of input.requestedIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (id === input.authorId) continue;
    if (!members.has(id)) continue;
    if (restricted && !visible.has(id)) continue;
    if (input.allowed && !input.allowed(id)) continue;
    kept.push(id);
  }
  return kept;
}

/** Keep tokens for validated pings and drop ids that failed the membership check. */
export function rewriteMentionText(
  text: string,
  kept: readonly MessengerMention[],
): string {
  const byId = new Map(kept.map((mention) => [mention.userId, mention]));
  let next = text.replace(MENTION_TOKEN, (_full, name: string, userId: string) => {
    const mention = byId.get(userId);
    if (!mention) return name;
    return mentionToken(mention.name, mention.userId);
  });
  for (const mention of kept) {
    const token = mentionToken(mention.name, mention.userId);
    if (next.includes(token)) continue;
    const bare = `@[${mention.name.replace(/[\[\]]/g, '').trim().slice(0, 80)}]`;
    if (bare.length > 3 && next.includes(bare)) {
      next = next.replace(bare, token);
    }
  }
  return next;
}

/** The word at the caret, with or without a leading @. */
export function activeMentionQuery(
  text: string,
  cursor: number,
): { start: number; end: number; query: string } | null {
  const before = text.slice(0, Math.max(0, cursor));
  const match = /(?:^|\s)(@?)([^\s@[\]]{1,80})$/.exec(before);
  if (!match?.[2]) return null;
  const query = match[2];
  const start = before.length - match[1].length - query.length;
  return { start, end: Math.max(0, cursor), query };
}
