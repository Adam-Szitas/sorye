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

const readStore = () => readStateFile.read();

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
  const [bootstrap, store] = await Promise.all([
    bootstrapMessenger(userId, workspaceId),
    readStore(),
  ]);
  if (!bootstrap) return 0;

  const lastReadByChannel = readMap(store, workspaceId, userId);
  let unread = 0;

  for (const message of bootstrap.messages) {
    if (message.author.id === userId) continue;
    const lastRead =
      lastReadByChannel[message.channelId] ?? '1970-01-01T00:00:00.000Z';
    if (message.createdAt > lastRead) unread += 1;
  }

  return unread;
}

export async function markMessengerRead(input: {
  userId: string;
  workspaceId: string;
  channelId?: string;
  through?: string;
}): Promise<void> {
  const bootstrap = await bootstrapMessenger(input.userId, input.workspaceId);
  if (!bootstrap) return;

  const stamp = input.through ?? new Date().toISOString();

  // Latest message per channel in one pass (messages are pre-sorted asc).
  const latestByChannel: Record<string, string> = {};
  for (const m of bootstrap.messages) {
    latestByChannel[m.channelId] = m.createdAt;
  }

  await readStateFile.update((store) => {
    const userMap = { ...readMap(store, input.workspaceId, input.userId) };

    if (input.channelId) {
      userMap[input.channelId] = latestByChannel[input.channelId] ?? stamp;
    } else {
      for (const channel of bootstrap.channels) {
        userMap[channel.id] = latestByChannel[channel.id] ?? stamp;
      }
    }

    store[input.workspaceId] = {
      ...(store[input.workspaceId] ?? {}),
      [input.userId]: userMap,
    };
  });
}
