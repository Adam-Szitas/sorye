import { and, asc, desc, eq, gt, lt, or } from 'drizzle-orm';
import * as schema from '@sorye/db/schema';
import type { MessengerMessage } from '@sorye/types';
import type { WorkspaceDb } from '@/lib/workspace-db';

export type ListMessagesQuery = {
  after?: string;
  afterId?: string;
  before?: string;
  limit: number;
};

export type ListMessagesOutcome =
  | { status: 'ok'; messages: MessengerMessage[]; hasMore: boolean }
  | { status: 'forbidden' }
  | { status: 'cursor' };

function compareMessages(a: MessengerMessage, b: MessengerMessage): number {
  const byTime = a.createdAt.localeCompare(b.createdAt);
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
}

function isOlderThan(message: MessengerMessage, cursor: MessengerMessage): boolean {
  const byTime = message.createdAt.localeCompare(cursor.createdAt);
  if (byTime !== 0) return byTime < 0;
  return message.id < cursor.id;
}

function rowToMessage(
  row: typeof schema.messengerMessages.$inferSelect,
): MessengerMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    workspaceId: row.workspaceId,
    kind: row.kind as MessengerMessage['kind'],
    text: row.text ?? undefined,
    imageDataUrl: row.imageDataUrl ?? undefined,
    imageBytes: row.imageBytes ?? undefined,
    imageWidth: row.imageWidth ?? undefined,
    imageHeight: row.imageHeight ?? undefined,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
  };
}

/** In-memory pagination for the JSON store (already loaded for a single channel). */
export function paginateChannelMessages(
  channelMessages: MessengerMessage[],
  query: ListMessagesQuery,
): ListMessagesOutcome {
  const sorted = [...channelMessages].sort(compareMessages);
  const limit = query.limit;

  if (query.after) {
    const newer = sorted.filter((m) => {
      const timeOrder = m.createdAt.localeCompare(query.after!);
      return timeOrder > 0 || (timeOrder === 0 && query.afterId !== undefined && m.id > query.afterId);
    });
    const hasMore = newer.length > limit;
    return {
      status: 'ok',
      messages: hasMore ? newer.slice(0, limit) : newer,
      hasMore,
    };
  }

  if (query.before) {
    const cursor = sorted.find((m) => m.id === query.before);
    if (!cursor) return { status: 'cursor' };
    const older = sorted.filter((m) => isOlderThan(m, cursor));
    const hasMore = older.length > limit;
    return {
      status: 'ok',
      messages: hasMore ? older.slice(older.length - limit) : older,
      hasMore,
    };
  }

  const hasMore = sorted.length > limit;
  return {
    status: 'ok',
    messages: hasMore ? sorted.slice(sorted.length - limit) : sorted,
    hasMore,
  };
}

/** SQL pagination for Hub Postgres and per-workspace DBs. */
export async function queryChannelMessagesPage(
  db: WorkspaceDb,
  channelId: string,
  query: ListMessagesQuery,
): Promise<ListMessagesOutcome> {
  const fetchLimit = query.limit + 1;

  if (query.after) {
    const afterDate = new Date(query.after);
    const afterCursor = query.afterId
      ? or(
          gt(schema.messengerMessages.createdAt, afterDate),
          and(eq(schema.messengerMessages.createdAt, afterDate), gt(schema.messengerMessages.id, query.afterId)),
        )
      : gt(schema.messengerMessages.createdAt, afterDate);
    const rows = await db
      .select()
      .from(schema.messengerMessages)
      .where(
        and(
          eq(schema.messengerMessages.channelId, channelId),
          afterCursor,
        ),
      )
      .orderBy(
        asc(schema.messengerMessages.createdAt),
        asc(schema.messengerMessages.id),
      )
      .limit(fetchLimit);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      status: 'ok',
      messages: page.map(rowToMessage),
      hasMore,
    };
  }

  if (query.before) {
    const [cursorRow] = await db
      .select()
      .from(schema.messengerMessages)
      .where(eq(schema.messengerMessages.id, query.before))
      .limit(1);

    if (!cursorRow || cursorRow.channelId !== channelId) {
      return { status: 'cursor' };
    }

    const rows = await db
      .select()
      .from(schema.messengerMessages)
      .where(
        and(
          eq(schema.messengerMessages.channelId, channelId),
          or(
            lt(schema.messengerMessages.createdAt, cursorRow.createdAt),
            and(
              eq(schema.messengerMessages.createdAt, cursorRow.createdAt),
              lt(schema.messengerMessages.id, cursorRow.id),
            ),
          ),
        ),
      )
      .orderBy(
        desc(schema.messengerMessages.createdAt),
        desc(schema.messengerMessages.id),
      )
      .limit(fetchLimit);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      status: 'ok',
      messages: page.reverse().map(rowToMessage),
      hasMore,
    };
  }

  const rows = await db
    .select()
    .from(schema.messengerMessages)
    .where(eq(schema.messengerMessages.channelId, channelId))
    .orderBy(
      desc(schema.messengerMessages.createdAt),
      desc(schema.messengerMessages.id),
    )
    .limit(fetchLimit);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  return {
    status: 'ok',
    messages: page.reverse().map(rowToMessage),
    hasMore,
  };
}
