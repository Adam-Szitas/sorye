import { getLocale, translate, type MessageKey, type MessageParams } from '@sorye/platform';
import { createDurableActionQueue, type DurableActionQueue } from '@sorye/platform';
import type { MessengerBootstrap, MessengerChannel, MessengerMessage, MessengerMessageKind, MessengerMessagesPage, RodrigoAction, RodrigoActionBatchResult, RodrigoActionResult } from '@sorye/types';
import { HUB_NOTIFY_EVENT, MESSENGER_PAGE_SIZE } from '@sorye/types';

type QueueState = { pending: number; failed: number; conflicts: number; rejected: number };
const queues = new Map<string, DurableActionQueue<RodrigoAction>>();

function hubPath(path: string) {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const origin = env?.VITE_HUB_ORIGIN?.trim();
  if (!origin || typeof window === 'undefined') return path;
  try { return window.location.origin === new URL(origin).origin ? path : new URL(path, origin).toString(); } catch { return path; }
}

const tr = (key: MessageKey, params?: MessageParams) => translate(getLocale(), key, params);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(hubPath(path), { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } }); }
  catch { throw new Error(tr('messenger.err.unreachable')); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof data.error?.code === 'string' ? data.error.code : 'request_failed';
    throw new Error(response.status >= 500 ? 'Rodrigo could not confirm this Messenger action. It remains queued in this browser.' : 'Messenger action failed (' + code + ').');
  }
  return data as T;
}

async function getQueue() {
  const { queueScope } = await request<{ queueScope: string }>('/api/messenger/scope');
  if (!/^[a-f0-9]{64}$/.test(queueScope)) throw new Error(tr('messenger.err.invalidScope'));
  let queue = queues.get(queueScope);
  if (!queue) { queue = createDurableActionQueue<RodrigoAction>({ appId: 'messenger', scope: queueScope, maxRows: 500 }); queues.set(queueScope, queue); }
  return { scope: queueScope, queue };
}

async function flush(scope: string, queue: DurableActionQueue<RodrigoAction>, only?: string) {
  const rows = await queue.list();
  for (const row of rows.filter((item) => (item.status === 'pending' || item.status === 'failed') && (!only || item.action.actionId === only))) {
    await queue.markAttempt(row.action.actionId);
    let batch: RodrigoActionBatchResult;
    try {
      batch = await request('/api/backend/actions/batch', { method: 'POST', headers: { 'X-Sorye-Queue-Scope': scope }, body: JSON.stringify({ actions: [row.action] }) });
    } catch (error) {
      await queue.markTransportFailure(row.action.actionId, { code: 'transport_failure', message: error instanceof Error ? error.message : 'Network failure' });
      continue;
    }
    const outcome = batch.results.find((item) => item.actionId === row.action.actionId);
    if (outcome) await queue.settle(outcome);
    else await queue.markTransportFailure(row.action.actionId, { code: 'missing_action_result', message: tr('messenger.err.noResult') });
  }
}

async function submit(action: RodrigoAction) {
  const { scope, queue } = await getQueue();
  await queue.enqueue(action);
  await flush(scope, queue, action.actionId);
  const row = (await queue.list()).find((item) => item.action.actionId === action.actionId);
  if (row) throw new Error(row.lastError?.message ?? row.lastError?.code ?? 'Rodrigo has not confirmed this Messenger action.');
}

function action(resourceType: RodrigoAction['resourceType'], resourceId: string, payload: Record<string, unknown>): RodrigoAction {
  return { actionId: crypto.randomUUID(), appId: 'messenger', resourceType, operation: 'create', resourceId, payloadVersion: 1, payload, occurredAt: new Date().toISOString() };
}

export async function getMessengerQueueState(): Promise<QueueState> {
  const { queue } = await getQueue(); const rows = await queue.list();
  return { pending: rows.filter((r) => r.status === 'pending').length, failed: rows.filter((r) => r.status === 'failed').length, conflicts: rows.filter((r) => r.status === 'conflict').length, rejected: rows.filter((r) => r.status === 'rejected').length };
}

export async function resendMessengerActions() { const { scope, queue } = await getQueue(); await flush(scope, queue); }
export async function discardMessengerConflicts() {
  const { queue } = await getQueue();
  for (const row of await queue.list()) if (row.status === 'conflict' || row.status === 'rejected') await queue.discard(row.action.actionId);
}
export async function loadMessenger(): Promise<MessengerBootstrap> {
  const result = await request<MessengerBootstrap>('/api/messenger');
  try { await resendMessengerActions(); } catch { /* Keep queued work for the next authorized start. */ }
  return result;
}

export async function openDm(peerUserId: string, userId: string): Promise<MessengerChannel> {
  const memberIds = [userId, peerUserId].sort(); const id = 'dm-' + memberIds[0] + '-' + memberIds[1]; const now = new Date().toISOString();
  await submit(action('channel', id, { id, name: 'Direct message', kind: 'direct', memberIds, updatedAt: now }));
  return { id, workspaceId: '', kind: 'dm', name: 'direct', memberIds, createdAt: now, createdBy: userId };
}
export async function createChannel(name: string, userId: string): Promise<MessengerChannel> {
  const clean = name.trim().replace(/\s+/g, '-').toLowerCase().slice(0, 32); if (!clean) throw new Error(tr('messenger.err.channelName'));
  const id = 'ch-' + crypto.randomUUID(); const now = new Date().toISOString();
  await submit(action('channel', id, { id, name: clean, kind: 'public', updatedAt: now }));
  return { id, workspaceId: '', kind: 'channel', name: clean, memberIds: [], createdAt: now, createdBy: userId };
}
export async function sendMessage(input: { channelId: string; kind: MessengerMessageKind; text?: string; mentions?: { userId: string }[]; imageDataUrl?: string; imageBytes?: number; imageWidth?: number; imageHeight?: number }): Promise<MessengerMessage> {
  if (input.kind === 'image' || input.imageDataUrl) throw new Error(tr('messenger.err.imageUnavailable'));
  const body = input.text?.trim() ?? ''; if (!body) throw new Error(tr('messenger.err.messageText'));
  const id = 'message-' + crypto.randomUUID(); const now = new Date().toISOString();
  const mentionUserIds = [...new Set((input.mentions ?? []).map((m) => m.userId))];
  await submit(action('message', id, { id, channelId: input.channelId, body, mentionUserIds, attachmentIds: [], createdAt: now, updatedAt: now }));
  return { id, channelId: input.channelId, workspaceId: '', kind: 'text', text: body, mentions: [], author: { id: '', name: '' }, createdAt: now };
}

export async function fetchMessages(input: { channelId: string; limit?: number; before?: string; after?: string; afterId?: string }): Promise<MessengerMessagesPage> {
  const params = new URLSearchParams({ channelId: input.channelId }); params.set('limit', String(input.limit ?? MESSENGER_PAGE_SIZE));
  if (input.before) params.set('before', input.before); if (input.after) params.set('after', input.after); if (input.afterId) params.set('afterId', input.afterId);
  const data = await request<MessengerMessagesPage>('/api/messenger/messages?' + params);
  return { messages: data.messages ?? [], hasMore: Boolean(data.hasMore) };
}
export async function pollMessages(channelId: string, after?: { createdAt: string; id: string }) {
  return fetchMessages({ channelId, after: after?.createdAt, afterId: after?.id, limit: MESSENGER_PAGE_SIZE });
}
export function mergeMessages(...pages: MessengerMessage[][]): MessengerMessage[] {
  const byId = new Map<string, MessengerMessage>(); for (const page of pages) for (const message of page) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export async function markMessengerRead(channelId?: string): Promise<void> {
  void channelId; // Read receipts remain unavailable until they have a Rodrigo contract.
  try { window.dispatchEvent(new CustomEvent(HUB_NOTIFY_EVENT)); } catch { /* optional local refresh */ }
}
