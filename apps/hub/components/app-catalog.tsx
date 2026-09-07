'use client';

import {
  APP_CATALOG,
  HUB_MANAGE_APPS_EVENT,
  HUB_OPEN_APP_EVENT,
  filterCatalogForViewer,
  getSelectedApps,
  workspaceCatalogEntries,
  type AppCatalogEntry,
} from '@sorye/types';
import { AppIcon } from '@/components/app-icon';
import type { PaneSide } from '@/components/app-workspace';
import { useEffect, useState } from 'react';

const CATEGORY_LABEL: Record<AppCatalogEntry['category'], string> = {
  productivity: 'Productivity',
  analytics: 'Analytics',
  communication: 'Communication',
  commerce: 'Commerce',
  developer: 'Developer',
  creative: 'Creative',
};

export function requestHubOpenApp(appId: string, side?: PaneSide) {
  window.dispatchEvent(
    new CustomEvent(HUB_OPEN_APP_EVENT, { detail: { appId, side } }),
  );
}

export function requestHubManageApps() {
  window.dispatchEvent(new CustomEvent(HUB_MANAGE_APPS_EVENT));
}

interface AppCatalogBrowserProps {
  paneSide?: PaneSide;
}

export function AppCatalogBrowser({ paneSide }: AppCatalogBrowserProps) {
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/workspace', { credentials: 'include' });
        if (!res.ok) {
          if (!cancelled) {
            setSelectedIds([]);
            setIsAdmin(false);
          }
          return;
        }
        const data = (await res.json()) as {
          workspace?: { selectedAppIds?: string[] };
          user?: { isAdmin?: boolean };
        };
        if (!cancelled) {
          setSelectedIds(data.workspace?.selectedAppIds ?? []);
          setIsAdmin(data.user?.isAdmin === true);
        }
      } catch {
        if (!cancelled) {
          setSelectedIds([]);
          setIsAdmin(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const installed = new Set(
    getSelectedApps(APP_CATALOG, selectedIds ?? [], { isAdmin }).map((a) => a.id),
  );
  const grouped = new Map<AppCatalogEntry['category'], AppCatalogEntry[]>();
  for (const app of filterCatalogForViewer(
    workspaceCatalogEntries(APP_CATALOG),
    isAdmin,
  )) {
    const list = grouped.get(app.category) ?? [];
    list.push(app);
    grouped.set(app.category, list);
  }

  function openApp(app: AppCatalogEntry) {
    const side =
      paneSide === 'left' ? 'right' : paneSide === 'right' ? 'left' : undefined;
    if (window.location.pathname.startsWith('/apps/')) {
      window.location.assign(app.mountPath);
      return;
    }
    requestHubOpenApp(app.id, side);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">App catalog</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Every Sorye app, for every workspace. Catalog is always on and does
          not use a plan slot.
        </p>
        <button
          type="button"
          onClick={() => {
            if (window.location.pathname.startsWith('/apps/')) {
              window.location.assign('/');
              return;
            }
            requestHubManageApps();
          }}
          className="mt-3 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition hover:bg-white/15"
        >
          Manage enabled apps
        </button>
      </header>

      {[...grouped.entries()].map(([category, apps]) => (
        <section key={category} className="mb-8">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {CATEGORY_LABEL[category]}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {apps.map((app) => {
              const isInstalled = installed.has(app.id);
              const canOpen =
                isInstalled &&
                (app.status === 'available' || app.status === 'beta') &&
                (Boolean(app.microFrontend) ||
                  Boolean(app.external) ||
                  app.alwaysAvailable === true);
              const isSelf = app.id === 'catalog';

              return (
                <li
                  key={app.id}
                  className="surface flex flex-col gap-3 rounded-2xl p-4"
                >
                  <div className="flex items-start gap-3">
                    <AppIcon app={app} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{app.name}</span>
                        {app.alwaysAvailable ? (
                          <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] uppercase text-indigo-300">
                            Always on
                          </span>
                        ) : null}
                        {app.adminOnly ? (
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
                            Admins
                          </span>
                        ) : null}
                        {app.status === 'coming_soon' ? (
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-text-muted)]">
                            Soon
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                        {app.description}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {app.usageIntro.summary}
                  </p>
                  <div className="mt-auto flex gap-2">
                    {isSelf ? (
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        You are here
                      </span>
                    ) : selectedIds === null ? (
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        Checking…
                      </span>
                    ) : canOpen ? (
                      <button
                        type="button"
                        className="rounded-lg bg-white/12 px-3 py-1.5 text-xs font-medium transition hover:bg-white/18"
                        onClick={() => openApp(app)}
                      >
                        Open
                      </button>
                    ) : app.status === 'coming_soon' ? (
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        Not shipped yet
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg bg-white/8 px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/12 hover:text-[var(--color-text)]"
                        onClick={() => requestHubManageApps()}
                      >
                        Enable in library
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
