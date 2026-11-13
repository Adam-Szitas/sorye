import { z } from 'zod';
import { RODRIGO_SERVICE_HUB_ACTOR, RODRIGO_SERVICE_WORKSPACE_ID, type RodrigoChange } from '@sorye/types';
import { readJson, signedFetch } from './transport';

/**
 * One subscription per Hub replica to Rodrigo's service change stream. Each change
 * invalidates the read cache and is offered to live fan-out listeners. The cursor lives in
 * memory: after a restart Hub starts from the head and the cache starts empty, so nothing
 * stale can be served. While disconnected, `healthy()` is false and the read cache is
 * bypassed.
 */
type Listener = (change: RodrigoChange) => void;
type ResetListener = () => void;

const SERVICE = { userId: RODRIGO_SERVICE_HUB_ACTOR, workspaceId: RODRIGO_SERVICE_WORKSPACE_ID };
const changeSchema: z.ZodType<RodrigoChange> = z.object({
  cursor: z.string().regex(/^\d{1,20}\.\d{1,20}$/), workspaceId: z.string().min(1).max(128), appId: z.string().min(1).max(64),
  resourceType: z.string().min(1).max(64), resourceId: z.string().min(1).max(160), revision: z.number().int().min(0),
  deleted: z.boolean(), occurredAt: z.string().max(64),
}).strict();

interface State {
  started: boolean; connected: boolean; cursor: string | null; lastEventAt: number;
  listeners: Set<Listener>; resets: Set<ResetListener>; stop: boolean; received: number; reconnects: number;
}
const key = Symbol.for('sorye.rodrigo.changes');
const g = globalThis as unknown as Record<symbol, State | undefined>;
function state(): State {
  g[key] ??= { started: false, connected: false, cursor: null, lastEventAt: 0, listeners: new Set(), resets: new Set(), stop: false, received: 0, reconnects: 0 };
  return g[key]!;
}

export function onRodrigoChange(listener: Listener): () => void {
  state().listeners.add(listener);
  ensureRodrigoChangeStream();
  return () => state().listeners.delete(listener);
}
/** Called when continuity is lost (cursor expired, reconnect gap): drop every cache. */
export function onRodrigoChangeReset(listener: ResetListener): () => void {
  state().resets.add(listener);
  return () => state().resets.delete(listener);
}
/** True while the stream is connected and has been heard from in the last 12 s. */
export function rodrigoChangesHealthy(): boolean {
  const s = state();
  return s.connected && Date.now() - s.lastEventAt < 12_000;
}
export function rodrigoChangeStats() {
  const s = state();
  return { connected: s.connected, cursor: s.cursor, received: s.received, reconnects: s.reconnects };
}

function reset(s: State) {
  for (const listener of s.resets) { try { listener(); } catch { /* listener faults are isolated */ } }
}

export function ensureRodrigoChangeStream(): void {
  const s = state();
  if (s.started || !process.env.RODRIGO_BASE_URL) return;
  s.started = true;
  void run(s);
}
/** Test hook. */
export function stopRodrigoChangeStream(): void {
  const s = state();
  s.stop = true;
}

async function run(s: State) {
  let backoff = 250;
  while (!s.stop) {
    try {
      if (s.cursor === null) {
        const head = await readJson(await signedFetch({ context: SERVICE, method: 'GET', path: '/v2/service/changes/head', scope: 'changes:read' }),
          z.object({ contractVersion: z.literal('2'), cursor: z.string().regex(/^\d{1,20}\.\d{1,20}$/) }).strict());
        s.cursor = head.cursor;
        reset(s);
      }
      const response = await signedFetch({
        context: SERVICE, method: 'GET', path: `/v2/service/changes/${s.cursor}`, scope: 'changes:read',
        headers: { Accept: 'text/event-stream' }, streamResponse: true, timeoutMs: 5000,
      });
      if (response.status === 410) { s.cursor = null; await response.body?.cancel(); continue; }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('stream refused'); }
      s.connected = true;
      s.lastEventAt = Date.now();
      backoff = 250;
      const expired = await consume(s, response.body);
      if (expired) s.cursor = null;
    } catch {
      // Fall through to reconnect. Never log assertions or payloads.
    }
    const wasConnected = s.connected;
    s.connected = false;
    s.reconnects += 1;
    if (s.stop) return;
    // A gap while disconnected is covered by replay from the cursor, so no reset needed;
    // but if we were down long, the cache was bypassed anyway via healthy().
    await new Promise((resolve) => setTimeout(resolve, wasConnected ? 50 : backoff + Math.random() * backoff));
    backoff = Math.min(backoff * 2, 5000);
  }
}

/** Parses SSE frames. Returns true when Rodrigo reports the cursor expired. */
async function consume(s: State, body: ReadableStream<Uint8Array>): Promise<boolean> {
  const reader = body.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let buffer = '';
  try {
    while (!s.stop) {
      const { value, done } = await reader.read();
      if (done) return false;
      s.lastEventAt = Date.now();
      buffer += value;
      if (buffer.length > 1_048_576) return false;
      let index: number;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trimStart();
        }
        if (event === 'stream.error') return data === 'cursor_expired';
        if (event !== 'change') continue;
        let parsed: RodrigoChange;
        try { parsed = changeSchema.parse(JSON.parse(data)); } catch { continue; }
        s.cursor = parsed.cursor;
        s.received += 1;
        for (const listener of s.listeners) { try { listener(parsed); } catch { /* isolated */ } }
      }
    }
    return false;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
