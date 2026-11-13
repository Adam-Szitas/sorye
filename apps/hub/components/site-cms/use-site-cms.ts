'use client';

import { createDurableActionQueue, registerPendingActionFlusher, type DurableActionQueue } from '@sorye/platform';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SiteDrafts } from '@/lib/site-cms/drafts';

/**
 * Loads the site drafts and writes them through the durable browser queue to
 * `/api/backend/actions/batch` (write-through: a change counts as saved only after
 * Rodrigo acknowledges it). Each save names the revision it edits, so concurrent
 * edits surface as conflicts instead of silent overwrites.
 */
export type SiteResourceType = 'settings' | 'cmsPage' | 'collection' | 'item' | 'media' | 'publish' | 'submission';

export interface SiteAction {
  actionId: string; appId: 'site'; resourceType: SiteResourceType; operation: 'create' | 'update' | 'delete';
  resourceId: string; expectedRevision?: number; payloadVersion: 1; payload: Record<string, unknown>; occurredAt: string;
}

export interface CmsData {
  drafts: SiteDrafts;
  live: { revisionId: string; publishedAt: string } | null;
  queueScope: string;
  canEdit: boolean;
  workspace: { id: string; name: string };
}

export type SaveOutcome = { ok: true; revision: number } | { ok: false; kind: 'conflict' | 'rejected' | 'transport'; code?: string };

export function useSiteCms() {
  const [data, setData] = useState<CmsData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState(0);
  const queue = useRef<DurableActionQueue<SiteAction> | null>(null);
  const scope = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/site/cms', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) { setLoadError(true); return null; }
      const next = await response.json() as CmsData;
      if (scope.current !== next.queueScope) {
        queue.current?.close();
        queue.current = createDurableActionQueue<SiteAction>({ appId: 'site', scope: next.queueScope });
        scope.current = next.queueScope;
      }
      setData(next);
      setLoadError(false);
      setPending((await queue.current!.list()).length);
      return next;
    } catch {
      setLoadError(true);
      return null;
    }
  }, []);

  const send = useCallback(async (action: SiteAction): Promise<SaveOutcome> => {
    const q = queue.current;
    if (!q || !scope.current) return { ok: false, kind: 'transport', code: 'queue_not_ready' };
    await q.markAttempt(action.actionId);
    try {
      const response = await fetch('/api/backend/actions/batch', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Sorye-Queue-Scope': scope.current },
        body: JSON.stringify({ actions: [action] }),
      });
      const body = await response.json().catch(() => ({})) as { results?: Array<{ actionId: string; status: string; revision?: number; error?: { code: string } }>; error?: { code?: string } };
      if (!response.ok) {
        // A refused shape never succeeds on retry: drop it so it cannot block the queue.
        if (response.status === 400 || response.status === 403) { await q.discard(action.actionId); return { ok: false, kind: 'rejected', code: body.error?.code ?? `http_${response.status}` }; }
        await q.markTransportFailure(action.actionId, { code: body.error?.code ?? 'request_failed' });
        return { ok: false, kind: 'transport', code: body.error?.code };
      }
      const outcome = body.results?.find((r) => r.actionId === action.actionId);
      if (!outcome) { await q.markTransportFailure(action.actionId, { code: 'missing_action_result' }); return { ok: false, kind: 'transport' }; }
      await q.settle(outcome as never);
      if (outcome.status === 'committed' || outcome.status === 'duplicate') return { ok: true, revision: outcome.revision ?? 0 };
      return { ok: false, kind: outcome.status === 'conflict' ? 'conflict' : 'rejected', code: outcome.error?.code };
    } catch {
      await q.markTransportFailure(action.actionId, { code: 'network_error' });
      return { ok: false, kind: 'transport', code: 'network_error' };
    } finally {
      setPending((await q.list()).length);
    }
  }, []);

  /** Saves one resource: create when `revision` is 0, otherwise update that revision. */
  const save = useCallback(async (resourceType: SiteResourceType, resourceId: string, revision: number, payload: Record<string, unknown> | null): Promise<SaveOutcome> => {
    const q = queue.current;
    if (!q) return { ok: false, kind: 'transport', code: 'queue_not_ready' };
    const operation = payload === null ? 'delete' : revision === 0 ? 'create' : 'update';
    const action: SiteAction = {
      actionId: crypto.randomUUID(), appId: 'site', resourceType, operation, resourceId,
      ...(operation === 'create' ? {} : { expectedRevision: revision }),
      payloadVersion: 1, payload: payload ?? {}, occurredAt: new Date().toISOString(),
    };
    await q.enqueue(action);
    return send(action);
  }, [send]);

  const flush = useCallback(async () => {
    const q = queue.current;
    if (!q) return 0;
    for (const row of await q.list()) {
      if (row.status === 'pending' || row.status === 'failed') await send(row.action);
    }
    const left = (await q.list()).length;
    setPending(left);
    return left;
  }, [send]);

  const discardRefused = useCallback(async () => {
    const q = queue.current;
    if (!q) return;
    for (const row of await q.list()) if (row.status === 'conflict' || row.status === 'rejected') await q.discard(row.action.actionId);
    setPending((await q.list()).length);
    await reload();
  }, [reload]);

  useEffect(() => { void reload().then(() => flush()); }, [reload, flush]);
  useEffect(() => {
    const unregister = registerPendingActionFlusher('site', flush);
    const onHide = () => { void flush(); };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('sorye:logout-flush', onHide);
    return () => { unregister(); window.removeEventListener('pagehide', onHide); window.removeEventListener('sorye:logout-flush', onHide); };
  }, [flush]);

  return { data, loadError, pending, reload, save, flush, discardRefused };
}

export function newId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
