'use client';

import type { AppCatalogEntry, SubscriptionPlan } from '@sorye/types';
import { prefetchMicroFrontend } from '@/lib/prefetch';
import { resolveRemoteEntry } from '@/lib/mf-remotes';
import { AppIcon } from './app-icon';
import type { PaneSide } from './app-workspace';

interface AppLauncherProps {
  apps: AppCatalogEntry[];
  plan: SubscriptionPlan;
  openLeftId?: string | null;
  openRightId?: string | null;
  onOpenApp: (app: AppCatalogEntry, side?: PaneSide) => void;
  onManageApps: () => void;
}

function prefetchApp(app: AppCatalogEntry) {
  if (app.microFrontend) {
    prefetchMicroFrontend(resolveRemoteEntry(app.microFrontend));
  }
}

export function AppLauncher({
  apps,
  plan,
  openLeftId,
  openRightId,
  onOpenApp,
  onManageApps,
}: AppLauncherProps) {
  const slotsRemaining = Math.max(0, plan.maxApps - apps.length);

  return (
    <section className="mx-auto w-full max-w-5xl flex-1">
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Welcome to your workspace
        </h1>
        <p className="mt-2 text-[var(--color-text-muted)]">
          {apps.length} of {plan.maxApps === 999 ? '∞' : plan.maxApps} apps
          active on the <span style={{ color: plan.accent }}>{plan.name}</span>{' '}
          plan
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Tap an app to open it full screen, or use L / R for a side-by-side desk
        </p>
      </header>

      <div className="app-grid grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {apps.map((app) => {
          const onLeft = openLeftId === app.id;
          const onRight = openRightId === app.id;
          const isOpen = onLeft || onRight;

          return (
            <div
              key={app.id}
              className={`app-tile-wrap group relative flex flex-col items-center gap-1 rounded-2xl p-2 transition ${
                isOpen ? 'bg-white/8 ring-1 ring-white/15' : 'hover:bg-white/5'
              }`}
            >
              <button
                type="button"
                onClick={() => onOpenApp(app)}
                onPointerEnter={() => prefetchApp(app)}
                onFocus={() => prefetchApp(app)}
                className="app-tile flex w-full flex-col items-center gap-2 rounded-2xl p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                aria-label={`Open ${app.name}`}
              >
                <div className="transition group-hover:scale-105 group-active:scale-95">
                  <AppIcon app={app} />
                </div>
                <span className="max-w-full truncate text-center text-xs font-medium text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]">
                  {app.name}
                </span>
                {app.status === 'coming_soon' && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                    Soon
                  </span>
                )}
                {app.external && app.status !== 'coming_soon' ? (
                  <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
                    Ext
                  </span>
                ) : null}
                {isOpen ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                    {onLeft && onRight
                      ? 'Open'
                      : onLeft
                        ? 'Left'
                        : 'Right'}
                  </span>
                ) : null}
              </button>

              {app.status === 'available' || app.status === 'beta' ? (
                <div className="flex w-full gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button
                    type="button"
                    className="flex-1 rounded-lg bg-white/8 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] transition hover:bg-white/14 hover:text-[var(--color-text)]"
                    onClick={() => onOpenApp(app, 'left')}
                    aria-label={`Open ${app.name} on the left`}
                  >
                    L
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-lg bg-white/8 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] transition hover:bg-white/14 hover:text-[var(--color-text)]"
                    onClick={() => onOpenApp(app, 'right')}
                    aria-label={`Open ${app.name} on the right`}
                  >
                    R
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}

        {Array.from({ length: slotsRemaining }).map((_, i) => (
          <button
            key={`empty-${i}`}
            type="button"
            onClick={onManageApps}
            className="app-tile flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 p-3 text-[var(--color-text-muted)] transition hover:border-white/20 hover:bg-white/5 hover:text-[var(--color-text)]"
            aria-label="Add an app to your workspace"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-white/15 text-2xl font-light">
              +
            </div>
            <span className="text-xs">Add app</span>
          </button>
        ))}
      </div>

      {apps.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-[var(--color-text-muted)]">
            No apps selected yet. Pick apps that match your workflow.
          </p>
          <button
            type="button"
            onClick={onManageApps}
            className="mt-4 rounded-xl px-6 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
            style={{ background: plan.accent }}
          >
            Choose your apps
          </button>
        </div>
      )}
    </section>
  );
}
