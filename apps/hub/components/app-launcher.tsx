'use client';

import type { AppCatalogEntry, SubscriptionPlan } from '@sorye/types';
import { prefetchMicroFrontend } from '@/lib/prefetch';
import { AppIcon } from './app-icon';

interface AppLauncherProps {
  apps: AppCatalogEntry[];
  plan: SubscriptionPlan;
  onOpenApp: (app: AppCatalogEntry) => void;
  onManageApps: () => void;
}

function prefetchApp(app: AppCatalogEntry) {
  if (app.microFrontend) {
    const entry =
      process.env.NEXT_PUBLIC_DASHBOARD_REMOTE ??
      app.microFrontend.remoteEntry;
    prefetchMicroFrontend(entry);
  }
}

export function AppLauncher({
  apps,
  plan,
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
      </header>

      <div className="app-grid grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {apps.map((app) => (
          <button
            key={app.id}
            type="button"
            onClick={() => onOpenApp(app)}
            onPointerEnter={() => prefetchApp(app)}
            onFocus={() => prefetchApp(app)}
            className="app-tile group flex flex-col items-center gap-2 rounded-2xl p-3 transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
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
          </button>
        ))}

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
