'use client';

import {
  APP_CATALOG,
  NOTIFIABLE_APP_IDS,
  type NotificationCenterSettings,
} from '@sorye/types';
import { useNotifications } from '@/lib/use-notifications';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function appName(appId: string): string {
  return APP_CATALOG.find((a) => a.id === appId)?.name ?? appId;
}

function toastAppOptions(settings: NotificationCenterSettings) {
  const ids = new Set([
    ...NOTIFIABLE_APP_IDS,
    ...Object.keys(settings.toastApps),
  ]);
  return [...ids].map((id) => ({
    id,
    name: appName(id),
    enabled: settings.toastApps[id] !== false,
  }));
}

export function NotificationCenter() {
  const {
    centerOpen,
    closeCenter,
    notifications,
    unreadTotal,
    settings,
    markAllRead,
    openNotification,
    updateSettings,
  } = useNotifications();

  if (!centerOpen) return null;

  const toastApps = toastAppOptions(settings);

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-black/40"
        aria-label="Close notification center"
        onClick={closeCenter}
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-md flex-col border-l border-white/10 bg-[var(--color-surface-raised)] shadow-2xl"
        aria-label="Notification center"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Notifications</h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              {unreadTotal > 0
                ? `${unreadTotal} unread`
                : 'You are all caught up'}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-[var(--color-text-muted)] hover:bg-white/10"
            onClick={closeCenter}
          >
            Close
          </button>
        </header>

        <section className="shrink-0 border-b border-white/8 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Toast popups
          </h3>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.toastsEnabled}
              onChange={(e) =>
                void updateSettings({ toastsEnabled: e.target.checked })
              }
            />
            Show toast messages when apps notify you
          </label>

          {settings.toastsEnabled ? (
            <div className="mt-3">
              <p className="text-xs text-[var(--color-text-muted)]">
                Choose which apps may show a toast (badges on the home screen
                always update):
              </p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {toastApps.map((app) => (
                  <li key={app.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={app.enabled}
                        onChange={(e) =>
                          void updateSettings({
                            toastApps: {
                              ...settings.toastApps,
                              [app.id]: e.target.checked,
                            },
                          })
                        }
                      />
                      {app.name}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-2">
          <span className="text-xs text-[var(--color-text-muted)]">Feed</span>
          {unreadTotal > 0 ? (
            <button
              type="button"
              className="text-xs text-[var(--color-accent)] hover:underline"
              onClick={() => void markAllRead()}
            >
              Mark all read
            </button>
          ) : null}
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {notifications.length === 0 ? (
            <li className="p-4 text-center text-sm text-[var(--color-text-muted)]">
              No notifications yet. Turn on App events and use OCR, Tasks, or
              Calendar — activity will show here and on app badges.
            </li>
          ) : (
            notifications.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`mb-1 w-full rounded-xl border p-3 text-left transition hover:bg-white/6 ${
                    item.read
                      ? 'border-white/6 bg-white/2 opacity-80'
                      : 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5'
                  }`}
                  onClick={() => openNotification(item)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                      {appName(item.appId)}
                      {!item.read ? (
                        <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] align-middle" />
                      ) : null}
                    </span>
                    <time className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
                      {formatWhen(item.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 text-sm font-medium">{item.title}</p>
                  {item.body ? (
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      {item.body}
                    </p>
                  ) : null}
                  <p className="mt-2 text-[10px] text-[var(--color-accent)]">
                    Open {appName(item.appId)} →
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>
    </>
  );
}
