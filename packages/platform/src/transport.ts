import {
  APP_CATALOG,
  HANDOFF_BROADCAST_CHANNEL,
  HUB_NOTIFY_EVENT,
  HUB_OPEN_APP_EVENT,
  NOTIFICATION_BROADCAST_CHANNEL,
  RELAY_BROADCAST_CHANNEL,
  WORKSPACE_EVENT_NAMES,
  type HandoffBroadcastMessage,
  type RelayBroadcastMessage,
  type WorkspaceEventName,
} from '@sorye/types';
import type {
  KernelEmitResult,
  KernelHandoffIntent,
  KernelIntent,
  KernelNavigateRequest,
  KernelNavigateResult,
} from './types';

export function hubUrl(path: string, hubOrigin?: string): string {
  if (!hubOrigin) return path;
  return new URL(path, hubOrigin).toString();
}

function isEventName(name: string): name is WorkspaceEventName {
  return (WORKSPACE_EVENT_NAMES as readonly string[]).includes(name);
}

/** Same refresh the existing remote `emit-event.ts` helpers use. Not a second bus. */
export function notifyWorkspaceBuses(kind: 'event' | 'handoff', handoff?: HandoffBroadcastMessage): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(HUB_NOTIFY_EVENT));
  } catch {
    // ignore
  }
  try {
    const relay = new BroadcastChannel(RELAY_BROADCAST_CHANNEL);
    relay.postMessage({ type: 'relay-updated' } satisfies RelayBroadcastMessage);
    relay.close();
  } catch {
    // ignore
  }
  try {
    const notif = new BroadcastChannel(NOTIFICATION_BROADCAST_CHANNEL);
    notif.postMessage({ type: 'notification-created' });
    notif.close();
  } catch {
    // ignore
  }
  if (kind === 'handoff' && handoff) {
    try {
      const channel = new BroadcastChannel(HANDOFF_BROADCAST_CHANNEL);
      channel.postMessage(handoff);
      channel.close();
    } catch {
      // ignore
    }
  }
}

async function readBody(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await res.json();
    if (data && typeof data === 'object') return data as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

/**
 * Posts an intent to the existing Hub routes. `workspaceId` is not sent.
 * `sourceAppId` on handoffs is the mounted app, not a caller-supplied id.
 */
export async function postKernelIntent(
  appId: string,
  intent: KernelIntent,
  hubOrigin?: string,
): Promise<KernelEmitResult> {
  if (intent.type === 'event') {
    if (!isEventName(intent.name)) {
      return { ok: false, status: 0, reason: 'unknown-event' };
    }
    if (!intent.payload?.title?.trim()) {
      return { ok: false, status: 0, reason: 'title-required' };
    }
    try {
      const res = await fetch(hubUrl('/api/events', hubOrigin), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: intent.name,
          payload: {
            ...intent.payload,
            appId: intent.payload.appId ?? appId,
          },
        }),
      });
      const body = await readBody(res);
      if (res.ok) notifyWorkspaceBuses('event');
      return {
        ok: res.ok,
        status: res.status,
        delivered: typeof body?.delivered === 'boolean' ? body.delivered : undefined,
        reason: res.ok
          ? typeof body?.reason === 'string'
            ? body.reason
            : undefined
          : typeof body?.error === 'string'
            ? body.error
            : 'request-failed',
      };
    } catch {
      return { ok: false, status: 0, reason: 'network' };
    }
  }

  return postHandoff(appId, intent, hubOrigin);
}

async function postHandoff(
  appId: string,
  intent: KernelHandoffIntent,
  hubOrigin?: string,
): Promise<KernelEmitResult> {
  if (intent.kind !== 'pdf-template') {
    return { ok: false, status: 0, reason: 'unsupported-handoff' };
  }
  if (!intent.targetAppId.trim() || !intent.title.trim() || intent.payload == null) {
    return { ok: false, status: 0, reason: 'handoff-fields-required' };
  }
  try {
    const res = await fetch(hubUrl('/api/handoffs', hubOrigin), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceAppId: appId,
        targetAppId: intent.targetAppId,
        kind: intent.kind,
        title: intent.title,
        summary: intent.summary,
        payload: intent.payload,
      }),
    });
    const body = await readBody(res);
    const handoff = body?.handoff;
    if (res.ok && handoff && typeof handoff === 'object') {
      const row = handoff as Record<string, unknown>;
      if (
        typeof row.id === 'string' &&
        typeof row.targetAppId === 'string' &&
        typeof row.sourceAppId === 'string' &&
        row.kind === 'pdf-template'
      ) {
        notifyWorkspaceBuses('handoff', {
          type: 'handoff-created',
          handoffId: row.id,
          targetAppId: row.targetAppId,
          sourceAppId: row.sourceAppId,
          kind: 'pdf-template',
        });
      } else {
        notifyWorkspaceBuses('event');
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      reason: res.ok
        ? undefined
        : typeof body?.error === 'string'
          ? body.error
          : 'request-failed',
    };
  } catch {
    return { ok: false, status: 0, reason: 'network' };
  }
}

export function navigateToApp(
  request: KernelNavigateRequest,
  options: { embedded: boolean; hubOrigin?: string },
): KernelNavigateResult {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-window' };

  if (options.embedded) {
    const event = new CustomEvent(HUB_OPEN_APP_EVENT, {
      cancelable: true,
      detail: { appId: request.appId, side: request.side },
    });
    window.dispatchEvent(event);
    if (event.defaultPrevented) return { ok: true };
    return assignMountPath(request.appId, undefined);
  }

  if (!options.hubOrigin) {
    return { ok: false, reason: 'standalone-needs-hub-origin' };
  }
  return assignMountPath(request.appId, options.hubOrigin);
}

function assignMountPath(appId: string, hubOrigin: string | undefined): KernelNavigateResult {
  const app = APP_CATALOG.find((entry) => entry.id === appId);
  if (!app) return { ok: false, reason: 'unknown-app' };
  if (typeof window === 'undefined') return { ok: false, reason: 'no-window' };
  const href = hubOrigin ? new URL(app.mountPath, hubOrigin).toString() : app.mountPath;
  window.location.assign(href);
  return { ok: true };
}
