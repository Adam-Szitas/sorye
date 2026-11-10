import { listMessengerUnreadPreviews, messengerReadSummary } from '@/lib/store/messenger-summary';
import { bootstrapMessenger } from '@/lib/store/messenger';
import { jsonDataFile } from '@/lib/store/json-file';

/** workspaceId → userId → channelId → last-read ISO timestamp */
type MessengerReadStore = Record<
  string,
  Record<string, Record<string, string>>
>;

const readStateFile = jsonDataFile<MessengerReadStore>(
  'messenger-read.json',
  () => ({}),
);

const readStore = (workspaceId: string) => readStateFile.read(workspaceId);

function readMap(
  store: MessengerReadStore,
  workspaceId: string,
  userId: string,
): Record<string, string> {
  return store[workspaceId]?.[userId] ?? {};
}

const MESSENGER_NOTICE_PREFIX = 'msgu:';

/** channelId -> last-read ISO timestamp for this member. */
export async function messengerReadMap(
  userId: string,
  workspaceId: string,
): Promise<Record<string, string>> {
  return readMap(await readStore(workspaceId), workspaceId, userId);
}

/** Channels this member can actually open. Empty when they have none. */
export async function accessibleMessengerChannelIds(
  userId: string,
  workspaceId: string,
): Promise<Set<string>> {
  const bootstrap = await bootstrapMessenger(userId, workspaceId);
  return new Set((bootstrap?.channels ?? []).map((channel) => channel.id));
}

export async function listMessengerUnreadNotices(
  userId: string,
  workspaceId: string,
): Promise<Array<{ id: string; channelId: string; title: string; body: string; createdAt: string }>> {
  const store = await readStore(workspaceId);
  const previews = await listMessengerUnreadPreviews(
    userId,
    workspaceId,
    readMap(store, workspaceId, userId),
  );
  return previews.map((item) => ({
    id: `${MESSENGER_NOTICE_PREFIX}${item.id}`,
    channelId: item.channelId,
    title: item.channelName.slice(0, 200) || 'Messenger',
    body: item.body,
    createdAt: item.createdAt,
  }));
}

export async function markMessengerUnreadNotices(input: {
  userId: string;
  workspaceId: string;
  noticeIds: string[];
}): Promise<void> {
  const wanted = new Set(
    input.noticeIds
      .filter((id) => id.startsWith(MESSENGER_NOTICE_PREFIX))
      .map((id) => id.slice(MESSENGER_NOTICE_PREFIX.length))
      .filter((id) => id.length > 0 && id.length <= 160),
  );
  if (wanted.size === 0) return;
  const store = await readStore(input.workspaceId);
  const previews = await listMessengerUnreadPreviews(
    input.userId,
    input.workspaceId,
    readMap(store, input.workspaceId, input.userId),
  );
  const through = new Map<string, string>();
  for (const item of previews) {
    if (!wanted.has(item.id)) continue;
    const previous = through.get(item.channelId);
    if (!previous || item.createdAt > previous) through.set(item.channelId, item.createdAt);
  }
  for (const [channelId, stamp] of through) {
    await markMessengerRead({
      userId: input.userId,
      workspaceId: input.workspaceId,
      channelId,
      through: stamp,
    });
  }
}

export async function countMessengerUnread(
  userId: string,
  workspaceId: string,
): Promise<number> {
  const store = await readStore(workspaceId);
  const summary = await messengerReadSummary(userId, workspaceId, readMap(store, workspaceId, userId));
  return summary.reduce((total, channel) => total + channel.unread, 0);
}

export async function markMessengerRead(input: {
  userId: string;
  workspaceId: string;
  channelId?: string;
  through?: string;
}): Promise<void> {
  const summary = await messengerReadSummary(input.userId, input.workspaceId, {});
  const latestByChannel = Object.fromEntries(summary.map(c => [c.channelId, new Date(c.latest).toISOString()]));
  if (input.channelId && !(input.channelId in latestByChannel)) return;
  const stamp = input.through ? new Date(input.through).toISOString() : new Date().toISOString();

  await readStateFile.update((store) => {
    const userMap = { ...readMap(store, input.workspaceId, input.userId) };

    if (input.channelId) {
      const latest = latestByChannel[input.channelId]!;
      const next = latest < stamp ? latest : stamp;
      userMap[input.channelId] = next > (userMap[input.channelId] ?? '') ? next : userMap[input.channelId]!;
    } else {
      for (const channel of summary) {
        const latest = latestByChannel[channel.channelId]!;
        const next = latest < stamp ? latest : stamp;
        if (next > (userMap[channel.channelId] ?? '')) userMap[channel.channelId] = next;
      }
    }

    store[input.workspaceId] = {
      ...(store[input.workspaceId] ?? {}),
      [input.userId]: userMap,
    };
  }, input.workspaceId);
}
