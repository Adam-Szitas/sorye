import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  dmChannelId,
  type MessengerChannel,
  type MessengerMessage,
  type MessengerMessageKind,
} from '@sorye/types';
import { getHubSession, getHubSessionForWorkspace, getWorkspaceMembers } from './json-store';

interface MessengerStoreData {
  channels: Record<string, MessengerChannel>;
  messages: Record<string, MessengerMessage>;
}

const DATA_DIR = path.join(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'messenger.json');

async function readStore(): Promise<MessengerStoreData> {
  try {
    const raw = await readFile(STORE_PATH, 'utf-8');
    return JSON.parse(raw) as MessengerStoreData;
  } catch {
    return { channels: {}, messages: {} };
  }
}

async function writeStore(data: MessengerStoreData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

async function assertMember(userId: string, workspaceId: string) {
  const active = await getHubSession(userId);
  if (!active) return null;
  if (active.workspace.id === workspaceId) {
    if (!active.workspace.memberIds.includes(userId)) return null;
    return active;
  }
  return getHubSessionForWorkspace(userId, workspaceId);
}

function canSeeChannel(channel: MessengerChannel, userId: string) {
  if (channel.kind === 'channel') return true;
  return channel.memberIds.includes(userId);
}

async function ensureDefaults(workspaceId: string, userId: string) {
  const store = await readStore();
  const existing = Object.values(store.channels).filter(
    (c) => c.workspaceId === workspaceId && c.kind === 'channel',
  );
  const now = new Date().toISOString();
  const names =
    existing.length > 0
      ? (['events'] as const)
      : (['general', 'random', 'events'] as const);

  let changed = false;
  for (const name of names) {
    const id = `ch-${workspaceId.slice(-6)}-${name}`;
    if (store.channels[id]) continue;
    const already = existing.some((c) => c.name === name);
    if (already) continue;
    store.channels[id] = {
      id,
      workspaceId,
      kind: 'channel',
      name,
      memberIds: [],
      createdAt: now,
      createdBy: userId,
    };
    changed = true;
  }
  if (changed) await writeStore(store);
  return store;
}

export async function ensureEventsChannel(
  workspaceId: string,
  createdBy: string,
): Promise<MessengerChannel> {
  const store = await readStore();
  const existing = Object.values(store.channels).find(
    (c) =>
      c.workspaceId === workspaceId &&
      c.kind === 'channel' &&
      c.name === 'events',
  );
  if (existing) return existing;

  const id = `ch-${workspaceId.slice(-6)}-events`;
  const channel: MessengerChannel = {
    id,
    workspaceId,
    kind: 'channel',
    name: 'events',
    memberIds: [],
    createdAt: new Date().toISOString(),
    createdBy,
  };
  store.channels[id] = channel;
  await writeStore(store);
  return channel;
}

export async function postSystemMessage(
  workspaceId: string,
  channelId: string,
  text: string,
  author: { id: string; name: string; image?: string },
): Promise<MessengerMessage | null> {
  const store = await readStore();
  const channel = store.channels[channelId];
  if (!channel || channel.workspaceId !== workspaceId) return null;
  if (!text.trim()) return null;

  const message: MessengerMessage = {
    id: `msg-${randomUUID().slice(0, 10)}`,
    channelId,
    workspaceId,
    kind: 'text',
    text: text.trim(),
    author,
    createdAt: new Date().toISOString(),
  };
  store.messages[message.id] = message;
  await writeStore(store);
  return message;
}

export async function bootstrapMessenger(userId: string, workspaceId: string) {
  const session = await assertMember(userId, workspaceId);
  if (!session) return null;

  await ensureDefaults(workspaceId, userId);
  const store = await readStore();
  const members = await getWorkspaceMembers(workspaceId);

  const channels = Object.values(store.channels)
    .filter((c) => c.workspaceId === workspaceId && canSeeChannel(c, userId))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'channel' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const visibleIds = new Set(channels.map((c) => c.id));
  const messages = Object.values(store.messages)
    .filter((m) => m.workspaceId === workspaceId && visibleIds.has(m.channelId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    workspace: {
      id: session.workspace.id,
      kind: session.workspace.kind,
      name: session.workspace.name,
    },
    user: {
      id: session.user.id,
      name: session.user.displayName,
      image: session.user.image,
    },
    members,
    channels,
    messages,
  };
}

export async function openDirectMessage(
  userId: string,
  workspaceId: string,
  peerUserId: string,
): Promise<MessengerChannel | null> {
  const session = await assertMember(userId, workspaceId);
  if (!session) return null;
  if (peerUserId === userId) return null;
  if (!session.workspace.memberIds.includes(peerUserId)) return null;

  const id = dmChannelId(userId, peerUserId);
  const store = await readStore();
  const existing = store.channels[id];
  if (existing) return existing;

  const channel: MessengerChannel = {
    id,
    workspaceId,
    kind: 'dm',
    name: 'direct',
    memberIds: [userId, peerUserId].sort(),
    createdAt: new Date().toISOString(),
    createdBy: userId,
  };
  store.channels[id] = channel;
  await writeStore(store);
  return channel;
}

export async function createPublicChannel(
  userId: string,
  workspaceId: string,
  name: string,
): Promise<MessengerChannel | null> {
  const session = await assertMember(userId, workspaceId);
  if (!session) return null;

  const trimmed = name.trim().replace(/\s+/g, '-').toLowerCase().slice(0, 32);
  if (!trimmed) return null;

  const channel: MessengerChannel = {
    id: `ch-${randomUUID().slice(0, 8)}`,
    workspaceId,
    kind: 'channel',
    name: trimmed,
    memberIds: [],
    createdAt: new Date().toISOString(),
    createdBy: userId,
  };

  const store = await readStore();
  store.channels[channel.id] = channel;
  await writeStore(store);
  return channel;
}

export async function postMessage(
  userId: string,
  workspaceId: string,
  input: {
    channelId: string;
    kind: MessengerMessageKind;
    text?: string;
    imageDataUrl?: string;
    imageBytes?: number;
    imageWidth?: number;
    imageHeight?: number;
  },
): Promise<MessengerMessage | null> {
  const session = await assertMember(userId, workspaceId);
  if (!session) return null;

  const store = await readStore();
  const channel = store.channels[input.channelId];
  if (!channel || channel.workspaceId !== workspaceId) return null;
  if (!canSeeChannel(channel, userId)) return null;

  if (input.kind === 'text' && !input.text?.trim()) return null;
  if (input.kind === 'image' && !input.imageDataUrl) return null;

  const message: MessengerMessage = {
    id: `msg-${randomUUID().slice(0, 10)}`,
    channelId: input.channelId,
    workspaceId,
    kind: input.kind,
    text: input.text?.trim() || undefined,
    imageDataUrl: input.imageDataUrl,
    imageBytes: input.imageBytes,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    author: {
      id: session.user.id,
      name: session.user.displayName,
      image: session.user.image,
    },
    createdAt: new Date().toISOString(),
  };

  store.messages[message.id] = message;
  await writeStore(store);
  return message;
}

export async function listMessages(
  userId: string,
  workspaceId: string,
  channelId: string,
  after?: string,
): Promise<MessengerMessage[] | null> {
  const session = await assertMember(userId, workspaceId);
  if (!session) return null;

  const store = await readStore();
  const channel = store.channels[channelId];
  if (!channel || channel.workspaceId !== workspaceId) return null;
  if (!canSeeChannel(channel, userId)) return null;

  return Object.values(store.messages)
    .filter((m) => m.channelId === channelId)
    .filter((m) => !after || m.createdAt > after)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
