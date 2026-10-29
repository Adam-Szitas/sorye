import type {
  MessengerBootstrap,
  MessengerChannel,
  MessengerMessage,
  MessengerMessageKind,
  MessengerMessagesPage,
} from '@sorye/types';
import { HUB_NOTIFY_EVENT, MESSENGER_PAGE_SIZE } from '@sorye/types';

export async function loadMessenger(): Promise<MessengerBootstrap> {
  const res = await fetch('/api/messenger', { credentials: 'include' });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? 'Sign in through the Hub to use Messenger.'
        : 'Could not load Messenger.',
    );
  }
  return (await res.json()) as MessengerBootstrap;
}

export async function openDm(peerUserId: string): Promise<MessengerChannel> {
  const res = await fetch('/api/messenger', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dm', peerUserId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not open DM');
  return data.channel as MessengerChannel;
}

export async function createChannel(name: string): Promise<MessengerChannel> {
  const res = await fetch('/api/messenger', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'channel', name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not create channel');
  return data.channel as MessengerChannel;
}

export async function sendMessage(input: {
  channelId: string;
  kind: MessengerMessageKind;
  text?: string;
  imageDataUrl?: string;
  imageBytes?: number;
  imageWidth?: number;
  imageHeight?: number;
}): Promise<MessengerMessage> {
  const res = await fetch('/api/messenger', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'message', ...input }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not send message');
  return data.message as MessengerMessage;
}

export async function fetchMessages(input: {
  channelId: string;
  limit?: number;
  before?: string;
  after?: string;
  afterId?: string;
}): Promise<MessengerMessagesPage> {
  const params = new URLSearchParams({ channelId: input.channelId });
  params.set('limit', String(input.limit ?? MESSENGER_PAGE_SIZE));
  if (input.before) params.set('before', input.before);
  if (input.after) params.set('after', input.after);
  if (input.afterId) params.set('afterId', input.afterId);
  const res = await fetch(`/api/messenger/messages?${params}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Could not load messages.');
  }
  const data = (await res.json()) as MessengerMessagesPage;
  return {
    messages: data.messages ?? [],
    hasMore: Boolean(data.hasMore),
  };
}

export async function pollMessages(
  channelId: string,
  after?: { createdAt: string; id: string },
): Promise<MessengerMessagesPage> {
  return fetchMessages({
    channelId,
    after: after?.createdAt,
    afterId: after?.id,
    limit: MESSENGER_PAGE_SIZE,
  });
}

export function mergeMessages(
  ...pages: MessengerMessage[][]
): MessengerMessage[] {
  const byId = new Map<string, MessengerMessage>();
  for (const page of pages) {
    for (const msg of page) byId.set(msg.id, msg);
  }
  return [...byId.values()].sort((a, b) => {
    const byTime = a.createdAt.localeCompare(b.createdAt);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}

export async function markMessengerRead(channelId?: string): Promise<void> {
  await fetch('/api/messenger', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'mark-read',
      ...(channelId ? { channelId } : {}),
    }),
  });
  try {
    window.dispatchEvent(new CustomEvent(HUB_NOTIFY_EVENT));
  } catch {
    // ignore
  }
}
