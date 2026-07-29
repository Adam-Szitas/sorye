import type {
  MessengerBootstrap,
  MessengerChannel,
  MessengerMessage,
  MessengerMessageKind,
} from '@sorye/types';

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

export async function pollMessages(
  channelId: string,
  after?: string,
): Promise<MessengerMessage[]> {
  const params = new URLSearchParams({ channelId });
  if (after) params.set('after', after);
  const res = await fetch(`/api/messenger/messages?${params}`, {
    credentials: 'include',
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { messages: MessengerMessage[] };
  return data.messages ?? [];
}
