import { randomUUID } from 'crypto';
import { and, eq, gt } from 'drizzle-orm';
import * as schema from '@sorye/db/schema';
import {
  dmChannelId,
  type MessengerChannel,
  type MessengerMessage,
  type MessengerMessageKind,
} from '@sorye/types';
import type { WorkspaceDb } from '@/lib/workspace-db';
import {
  getHubSession,
  getHubSessionForWorkspace,
  getWorkspaceMembers,
} from './postgres-store';

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

function rowToChannel(
  row: typeof schema.messengerChannels.$inferSelect,
): MessengerChannel {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind as MessengerChannel['kind'],
    name: row.name,
    memberIds: row.memberIds,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

function rowToMessage(
  row: typeof schema.messengerMessages.$inferSelect,
): MessengerMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    workspaceId: row.workspaceId,
    kind: row.kind as MessengerMessageKind,
    text: row.text ?? undefined,
    imageDataUrl: row.imageDataUrl ?? undefined,
    imageBytes: row.imageBytes ?? undefined,
    imageWidth: row.imageWidth ?? undefined,
    imageHeight: row.imageHeight ?? undefined,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
  };
}

async function ensureDefaults(
  db: WorkspaceDb,
  workspaceId: string,
  userId: string,
) {
  const existing = await db
    .select({
      id: schema.messengerChannels.id,
      name: schema.messengerChannels.name,
    })
    .from(schema.messengerChannels)
    .where(
      and(
        eq(schema.messengerChannels.workspaceId, workspaceId),
        eq(schema.messengerChannels.kind, 'channel'),
      ),
    );

  const names =
    existing.length > 0
      ? (['events'] as const)
      : (['general', 'random', 'events'] as const);
  const have = new Set(existing.map((r) => r.name));

  for (const name of names) {
    if (have.has(name)) continue;
    const id = `ch-${workspaceId.slice(-6)}-${name}`;
    await db
      .insert(schema.messengerChannels)
      .values({
        id,
        workspaceId,
        kind: 'channel',
        name,
        memberIds: [],
        createdBy: userId,
      })
      .onConflictDoNothing();
  }
}

export async function ensureEventsChannel(
  db: WorkspaceDb,
  workspaceId: string,
  createdBy: string,
): Promise<MessengerChannel> {
  const [existing] = await db
    .select()
    .from(schema.messengerChannels)
    .where(
      and(
        eq(schema.messengerChannels.workspaceId, workspaceId),
        eq(schema.messengerChannels.kind, 'channel'),
        eq(schema.messengerChannels.name, 'events'),
      ),
    )
    .limit(1);
  if (existing) return rowToChannel(existing);

  const id = `ch-${workspaceId.slice(-6)}-events`;
  const [row] = await db
    .insert(schema.messengerChannels)
    .values({
      id,
      workspaceId,
      kind: 'channel',
      name: 'events',
      memberIds: [],
      createdBy,
    })
    .onConflictDoNothing()
    .returning();

  if (row) return rowToChannel(row);

  const [again] = await db
    .select()
    .from(schema.messengerChannels)
    .where(eq(schema.messengerChannels.id, id))
    .limit(1);
  return again
    ? rowToChannel(again)
    : {
        id,
        workspaceId,
        kind: 'channel',
        name: 'events',
        memberIds: [],
        createdAt: new Date().toISOString(),
        createdBy,
      };
}

export async function postSystemMessage(
  db: WorkspaceDb,
  workspaceId: string,
  channelId: string,
  text: string,
  author: { id: string; name: string; image?: string },
): Promise<MessengerMessage | null> {
  const [channelRow] = await db
    .select()
    .from(schema.messengerChannels)
    .where(eq(schema.messengerChannels.id, channelId))
    .limit(1);
  if (!channelRow || channelRow.workspaceId !== workspaceId) return null;
  if (!text.trim()) return null;

  const [row] = await db
    .insert(schema.messengerMessages)
    .values({
      id: `msg-${randomUUID().slice(0, 10)}`,
      channelId,
      workspaceId,
      kind: 'text',
      text: text.trim(),
      author,
    })
    .returning();

  return row ? rowToMessage(row) : null;
}

export async function bootstrapMessenger(
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
) {
  const session = await assertMember(userId, workspaceId);
  if (!session) return null;

  await ensureDefaults(db, workspaceId, userId);
  const members = await getWorkspaceMembers(workspaceId);

  const channelRows = await db
    .select()
    .from(schema.messengerChannels)
    .where(eq(schema.messengerChannels.workspaceId, workspaceId));

  const channels = channelRows
    .map(rowToChannel)
    .filter((c) => canSeeChannel(c, userId))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'channel' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const visibleIds = new Set(channels.map((c) => c.id));
  const messageRows = await db
    .select()
    .from(schema.messengerMessages)
    .where(eq(schema.messengerMessages.workspaceId, workspaceId));

  const messages = messageRows
    .map(rowToMessage)
    .filter((m) => visibleIds.has(m.channelId))
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
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
  peerUserId: string,
): Promise<MessengerChannel | null> {
  const session = await assertMember(userId, workspaceId);
  if (!session) return null;
  if (peerUserId === userId) return null;
  if (!session.workspace.memberIds.includes(peerUserId)) return null;

  const id = dmChannelId(userId, peerUserId);
  const [existing] = await db
    .select()
    .from(schema.messengerChannels)
    .where(eq(schema.messengerChannels.id, id))
    .limit(1);
  if (existing) return rowToChannel(existing);

  const [row] = await db
    .insert(schema.messengerChannels)
    .values({
      id,
      workspaceId,
      kind: 'dm',
      name: 'direct',
      memberIds: [userId, peerUserId].sort(),
      createdBy: userId,
    })
    .returning();

  return row ? rowToChannel(row) : null;
}

export async function createPublicChannel(
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
  name: string,
): Promise<MessengerChannel | null> {
  const session = await assertMember(userId, workspaceId);
  if (!session) return null;

  const trimmed = name.trim().replace(/\s+/g, '-').toLowerCase().slice(0, 32);
  if (!trimmed) return null;

  const [row] = await db
    .insert(schema.messengerChannels)
    .values({
      id: `ch-${randomUUID().slice(0, 8)}`,
      workspaceId,
      kind: 'channel',
      name: trimmed,
      memberIds: [],
      createdBy: userId,
    })
    .returning();

  return row ? rowToChannel(row) : null;
}

export async function postMessage(
  db: WorkspaceDb,
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

  const [channelRow] = await db
    .select()
    .from(schema.messengerChannels)
    .where(eq(schema.messengerChannels.id, input.channelId))
    .limit(1);

  if (!channelRow || channelRow.workspaceId !== workspaceId) return null;
  const channel = rowToChannel(channelRow);
  if (!canSeeChannel(channel, userId)) return null;

  if (input.kind === 'text' && !input.text?.trim()) return null;
  if (input.kind === 'image' && !input.imageDataUrl) return null;

  const [row] = await db
    .insert(schema.messengerMessages)
    .values({
      id: `msg-${randomUUID().slice(0, 10)}`,
      channelId: input.channelId,
      workspaceId,
      kind: input.kind,
      text: input.text?.trim() || null,
      imageDataUrl: input.imageDataUrl ?? null,
      imageBytes: input.imageBytes ?? null,
      imageWidth: input.imageWidth ?? null,
      imageHeight: input.imageHeight ?? null,
      author: {
        id: session.user.id,
        name: session.user.displayName,
        image: session.user.image,
      },
    })
    .returning();

  return row ? rowToMessage(row) : null;
}

export async function listMessages(
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
  channelId: string,
  after?: string,
): Promise<MessengerMessage[] | null> {
  const session = await assertMember(userId, workspaceId);
  if (!session) return null;

  const [channelRow] = await db
    .select()
    .from(schema.messengerChannels)
    .where(eq(schema.messengerChannels.id, channelId))
    .limit(1);

  if (!channelRow || channelRow.workspaceId !== workspaceId) return null;
  if (!canSeeChannel(rowToChannel(channelRow), userId)) return null;

  const rows = after
    ? await db
        .select()
        .from(schema.messengerMessages)
        .where(
          and(
            eq(schema.messengerMessages.channelId, channelId),
            gt(schema.messengerMessages.createdAt, new Date(after)),
          ),
        )
    : await db
        .select()
        .from(schema.messengerMessages)
        .where(eq(schema.messengerMessages.channelId, channelId));

  return rows
    .map(rowToMessage)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
