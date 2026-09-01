import type {
  AppHandoff,
  HandoffBroadcastMessage,
} from '@sorye/types';
import { HANDOFF_BROADCAST_CHANNEL } from '@sorye/types';
import type { PdfTemplate } from '@protocolio/sdk';

export async function fetchHandoff(id: string): Promise<AppHandoff | null> {
  try {
    const res = await fetch(`/api/handoffs?id=${encodeURIComponent(id)}`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { handoff: AppHandoff };
    return data.handoff;
  } catch {
    return null;
  }
}

export async function fetchLatestProtocolioHandoff(): Promise<AppHandoff | null> {
  try {
    const res = await fetch(
      '/api/handoffs?targetAppId=protocolio&unconsumed=1',
      { credentials: 'include' },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { handoffs: AppHandoff[] };
    return data.handoffs[0] ?? null;
  } catch {
    return null;
  }
}

export async function markHandoffConsumed(id: string): Promise<void> {
  try {
    await fetch('/api/handoffs', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, consume: true }),
    });
  } catch {
    // non-fatal
  }
}

export function isPdfTemplate(value: unknown): value is PdfTemplate {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    Array.isArray((value as PdfTemplate).blocks)
  );
}

export function subscribeToHandoffs(
  onHandoff: (handoffId: string) => void,
): () => void {
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(HANDOFF_BROADCAST_CHANNEL);
    channel.onmessage = (event: MessageEvent<HandoffBroadcastMessage>) => {
      const data = event.data;
      if (
        data?.type === 'handoff-created' &&
        data.targetAppId === 'protocolio' &&
        data.handoffId
      ) {
        onHandoff(data.handoffId);
      }
    };
  } catch {
    channel = null;
  }

  return () => {
    channel?.close();
  };
}
