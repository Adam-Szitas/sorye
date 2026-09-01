'use client';

import { ExternalAppFrame } from '@/components/external-app-frame';
import { MicroAppLoader } from '@/components/micro-app-loader';
import { AppCatalogBrowser } from '@/components/app-catalog';
import { AppUsageGuide } from '@/components/app-usage-guide';
import {
  APP_CATALOG,
  getAppBySlug,
  type AppCatalogEntry,
} from '@sorye/types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function MicroAppPage() {
  const params = useParams<{ slug: string }>();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [app, setApp] = useState<AppCatalogEntry | null>(null);

  useEffect(() => {
    const catalogApp = getAppBySlug(APP_CATALOG, params.slug);
    setApp(catalogApp ?? null);

    async function checkAccess() {
      const res = await fetch('/api/workspace');
      if (!res.ok) {
        setAllowed(false);
        return;
      }
      const data = await res.json();
      const isAllowed =
        catalogApp &&
        (catalogApp.status === 'available' || catalogApp.status === 'beta') &&
        (catalogApp.alwaysAvailable === true ||
          data.workspace.selectedAppIds.includes(catalogApp.id));
      setAllowed(Boolean(isAllowed));
    }

    checkAccess();
  }, [params.slug]);

  if (allowed === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
      </div>
    );
  }

  if (!app || !allowed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
        <p className="text-[var(--color-text-muted)]">
          This app is not available on your workspace.
        </p>
        <Link
          href="/"
          className="rounded-xl bg-white/10 px-4 py-2 text-sm transition hover:bg-white/15"
        >
          Back to Hub
        </Link>
      </div>
    );
  }

  if (!app.microFrontend && !app.external) {
    if (app.id === 'catalog') {
      return (
        <div className="flex h-dvh max-h-dvh flex-col overflow-hidden">
          <header className="glass flex shrink-0 items-center gap-4 px-4 py-3 sm:px-6">
            <Link
              href="/"
              className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
            >
              ← Hub
            </Link>
            <span className="text-sm font-medium">{app.name}</span>
          </header>
          <AppCatalogBrowser />
        </div>
      );
    }
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
        <p className="text-[var(--color-text-muted)]">
          {app.name} is not wired as a micro-frontend yet.
        </p>
        <Link href="/" className="text-sm text-[var(--color-accent)]">
          Back to Hub
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-dvh max-h-dvh flex-col overflow-hidden">
      <header className="glass flex shrink-0 items-center gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
        >
          ← Hub
        </Link>
        <span className="text-sm font-medium">{app.name}</span>
        {app.external ? (
          <a
            href={app.external.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-[var(--color-text-muted)] transition hover:text-[var(--color-accent)]"
          >
            Open externally ↗
          </a>
        ) : null}
      </header>
      <AppUsageGuide app={app} variant="pane" />
      <div className="flex min-h-0 flex-1 flex-col">
        {app.external ? (
          <ExternalAppFrame config={app.external} appName={app.name} />
        ) : app.microFrontend ? (
          <MicroAppLoader config={app.microFrontend} />
        ) : null}
      </div>
    </div>
  );
}
