'use client';

import { APP_CATALOG } from '@sorye/types';
import { useNotifications } from '@/lib/use-notifications';
import { useEffect, useRef } from 'react';

function appName(appId: string): string {
  return APP_CATALOG.find((a) => a.id === appId)?.name ?? appId;
}

const TOAST_TTL_MS = 8000;

export function NotificationToasts() {
  const { toasts, dismissToast, notifications, openNotification } =
    useNotifications();
  // One timer per toast, scheduled once when it first appears — re-renders
  // from newer toasts must not reset the countdown of existing ones.
  const timers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const active = new Set(toasts.map((t) => t.id));

    for (const toast of toasts) {
      if (timers.current.has(toast.id)) continue;
      const handle = window.setTimeout(() => {
        timers.current.delete(toast.id);
        dismissToast(toast.id);
      }, TOAST_TTL_MS);
      timers.current.set(toast.id, handle);
    }

    for (const [id, handle] of timers.current) {
      if (!active.has(id)) {
        window.clearTimeout(handle);
        timers.current.delete(id);
      }
    }
  }, [toasts, dismissToast]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const handle of map.values()) window.clearTimeout(handle);
      map.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-16 z-[60] flex w-[min(100%,22rem)] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const full = notifications.find((n) => n.id === toast.id);
        return (
          <button
            key={toast.id}
            type="button"
            className="pointer-events-auto surface w-full rounded-xl p-3 text-left shadow-lg ring-1 ring-[var(--color-accent)]/25 transition hover:ring-[var(--color-accent)]/50"
            role="status"
            onClick={() => {
              if (full) {
                openNotification(full);
              } else {
                dismissToast(toast.id);
              }
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                  {appName(toast.appId)}
                </p>
                <p className="mt-0.5 text-sm font-medium leading-snug">
                  {toast.title}
                </p>
                {toast.body ? (
                  <p className="mt-1 text-xs leading-snug text-[var(--color-text-muted)]">
                    {toast.body}
                  </p>
                ) : null}
                <p className="mt-1.5 text-[10px] text-[var(--color-accent)]">
                  Tap to open app
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-md px-1.5 py-0.5 text-sm text-[var(--color-text-muted)] hover:bg-white/10"
                aria-label="Dismiss toast"
                onClick={(e) => {
                  e.stopPropagation();
                  dismissToast(toast.id);
                }}
              >
                ×
              </button>
            </div>
          </button>
        );
      })}
    </div>
  );
}
