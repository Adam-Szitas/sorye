'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AdminLoadState<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; data: T; at: number }
  | { kind: 'forbidden' }
  | { kind: 'unavailable'; code: string };

/**
 * One admin JSON resource. Refreshes on an interval only while the tab is
 * visible and online; concurrent refreshes coalesce into one request.
 */
export function useAdminJson<T>(url: string, refreshMs = 0) {
  const [state, setState] = useState<AdminLoadState<T>>({ kind: 'loading' });
  const inflight = useRef<Promise<void> | null>(null);

  const load = useCallback((background = false): Promise<void> => {
    if (inflight.current) return inflight.current;
    const run = (async () => {
      try {
        const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', priority: background ? 'low' : 'auto' });
        if (res.status === 401 || res.status === 403) {
          setState({ kind: 'forbidden' });
          return;
        }
        const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
        if (!res.ok || !body) {
          setState((previous) => previous.kind === 'ready' && background ? previous : { kind: 'unavailable', code: body?.error ?? `http_${res.status}` });
          return;
        }
        setState({ kind: 'ready', data: body, at: Date.now() });
      } catch {
        setState((previous) => previous.kind === 'ready' && background ? previous : { kind: 'unavailable', code: 'network' });
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [url]);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    if (!refreshMs) return () => window.clearTimeout(first);
    let interval: number | undefined;
    const active = () => document.visibilityState === 'visible' && navigator.onLine;
    const schedule = () => {
      window.clearInterval(interval);
      interval = active() ? window.setInterval(() => { void load(true); }, refreshMs) : undefined;
    };
    const resume = () => {
      if (active()) void load(true);
      schedule();
    };
    schedule();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', schedule);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', schedule);
    };
  }, [load, refreshMs]);

  return { state, reload: load };
}

export async function adminSend<T = Record<string, unknown>>(url: string, method: 'POST' | 'PUT', body: unknown): Promise<{ status: number; body: (T & { error?: string; detail?: string }) | null }> {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as (T & { error?: string; detail?: string }) | null };
  } catch {
    return { status: 0, body: null };
  }
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
