import { getDb } from '@sorye/db';
import { messengerMessages, messengerChannels } from '@sorye/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
