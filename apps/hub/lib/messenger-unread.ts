import { messengerReadSummary } from '@/lib/store/messenger-summary';
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
