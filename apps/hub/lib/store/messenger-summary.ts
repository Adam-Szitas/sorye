import { getDb } from '@sorye/db';
import { messengerMessages, messengerChannels } from '@sorye/db/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getStoreDriver } from '@/lib/env';
import { withWorkspaceDb, type WorkspaceDb } from '@/lib/workspace-db';
import { bootstrapMessenger } from './messenger';

export async function messengerReadSummary(userId: string, workspaceId: string, read: Record<string, string>) {
  const bootstrap = await bootstrapMessenger(userId, workspaceId);
  if (!bootstrap) return [];
  const ids = bootstrap.channels.map(c => c.id);
  if (!ids.length) return [];
  const query = (db: WorkspaceDb) => db.select({
    channelId: messengerChannels.id,
    latest: sql<string>`coalesce((select ${messengerMessages.createdAt} from ${messengerMessages}
      where ${messengerMessages.channelId} = ${messengerChannels.id} and ${messengerMessages.workspaceId} = ${workspaceId}
      order by ${messengerMessages.createdAt} desc limit 1), 'epoch'::timestamptz)::text`,
    unread: sql<number>`(select count(*)::int from ${messengerMessages}
      where ${messengerMessages.channelId} = ${messengerChannels.id} and ${messengerMessages.workspaceId} = ${workspaceId}
      and ${messengerMessages.author}->>'id' <> ${userId}
      and ${messengerMessages.createdAt} > coalesce((${JSON.stringify(read)}::jsonb ->> ${messengerChannels.id})::timestamptz, 'epoch'::timestamptz))`,
  }).from(messengerChannels).where(and(
    eq(messengerChannels.workspaceId, workspaceId), inArray(messengerChannels.id, ids),
  ));
  return withWorkspaceDb(workspaceId, query, async () => {
    if (getStoreDriver() === 'postgres') return query(getDb());
    const full = await bootstrapMessenger(userId, workspaceId, { includeMessages: true });
    return ids.map(channelId => {
      const messages = full?.messages.filter(m => m.channelId === channelId) ?? [];
      return { channelId, latest: messages.at(-1)?.createdAt ?? new Date(0).toISOString(),
        unread: messages.filter(m => m.author.id !== userId && m.createdAt > (read[channelId] ?? '')).length };
    });
  });
}

export interface MessengerUnreadPreview {
  id: string;
  channelId: string;
  channelName: string;
  body: string;
  createdAt: string;
}

function previewBody(kind: string, text: string | null | undefined): string {
  const cleaned = (text ?? '').replace(/@\[([^\]\r\n]{1,80})\]\([^)]+\)/g, '@$1').trim();
  if (cleaned) return cleaned.slice(0, 180);
  return kind === 'image' ? 'Photo' : 'New message';
}

/** Unread messages the launcher badge counts, capped so the notification list can show the same rows. */
export async function listMessengerUnreadPreviews(
  userId: string,
  workspaceId: string,
  read: Record<string, string>,
  limit = 50,
): Promise<MessengerUnreadPreview[]> {
  const bootstrap = await bootstrapMessenger(userId, workspaceId);
  if (!bootstrap) return [];
  const names = new Map(bootstrap.channels.map((channel) => [channel.id, channel.name]));
  const ids = [...names.keys()];
  if (!ids.length) return [];
  const cap = Math.min(50, Math.max(1, limit));
  const query = (db: WorkspaceDb) => db.select({
    id: messengerMessages.id,
    channelId: messengerMessages.channelId,
    kind: messengerMessages.kind,
    text: messengerMessages.text,
    createdAt: messengerMessages.createdAt,
  }).from(messengerMessages).innerJoin(
    messengerChannels,
    eq(messengerMessages.channelId, messengerChannels.id),
  ).where(and(
    eq(messengerMessages.workspaceId, workspaceId),
    inArray(messengerMessages.channelId, ids),
    sql`${messengerMessages.author}->>'id' <> ${userId}`,
    sql`${messengerMessages.createdAt} > coalesce((${JSON.stringify(read)}::jsonb ->> ${messengerChannels.id})::timestamptz, 'epoch'::timestamptz)`,
  )).orderBy(desc(messengerMessages.createdAt)).limit(cap);

  const rows = await withWorkspaceDb(workspaceId, query, async () => {
    if (getStoreDriver() === 'postgres') return query(getDb());
    const full = await bootstrapMessenger(userId, workspaceId, { includeMessages: true });
    return (full?.messages ?? [])
      .filter((message) => names.has(message.channelId) && message.author.id !== userId && message.createdAt > (read[message.channelId] ?? ''))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, cap)
      .map((message) => ({
        id: message.id,
        channelId: message.channelId,
        kind: message.kind,
        text: message.text ?? null,
        createdAt: new Date(message.createdAt),
      }));
  });

  return rows.map((row) => ({
    id: row.id,
    channelId: row.channelId,
    channelName: names.get(row.channelId) || 'Messenger',
    body: previewBody(row.kind, row.text),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
  }));
}
