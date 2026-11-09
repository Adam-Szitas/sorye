'use client';

import { ExternalAppFrame } from '@/components/external-app-frame';
import { MicroAppLoader, preloadMicroApp } from '@/components/micro-app-loader';
import { StandaloneAppBar } from '@/components/standalone-app-bar';
import { HubNativeAppBody } from '@/components/hub-native-app';
import { AppUsageGuide } from '@/components/app-usage-guide';
import {
  isPresentationalTryoutApp,
  shouldShowUsageGuide,
} from '@/lib/usage-guide';
import {
  APP_CATALOG,
  getAppBySlug,
  isHubNativeApp,
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

    // Download the remote while the workspace check is in flight. This only
    // fetches code: nothing below renders until `allowed` is true, and apps
    // the catalog already rules out or reserves for admins are not fetched.
    if (
      catalogApp?.microFrontend &&
      (catalogApp.status === 'available' || catalogApp.status === 'beta') &&
      catalogApp.adminOnly !== true
    ) {
      preloadMicroApp(catalogApp.microFrontend);
    }

    async function checkAccess() {
      const res = await fetch('/api/workspace', { credentials: 'include' });
      if (!res.ok) {
        setAllowed(false);
        return;
      }
      const data = await res.json();
      const isAdmin = data.user?.isAdmin === true;
      const isAllowed =
        catalogApp &&
        (catalogApp.status === 'available' || catalogApp.status === 'beta') &&
        (catalogApp.adminOnly !== true || isAdmin) &&
        (catalogApp.alwaysAvailable === true ||
          isPresentationalTryoutApp(catalogApp.id) ||
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
    if (isHubNativeApp(app)) {
      return (
        <div className="flex h-dvh max-h-dvh flex-col overflow-hidden">
          <StandaloneAppBar appName={app.name} />
          {shouldShowUsageGuide(app.id) ? (
            <AppUsageGuide app={app} variant="pane" />
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <HubNativeAppBody app={app} />
          </div>
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
      <StandaloneAppBar appName={app.name}>
        {app.external ? (
          <a
            href={app.external.url}
            target="_blank"
            rel="noreferrer"
            className="sorye-app-bar-hub"
          >
            Open externally ↗
          </a>
        ) : null}
      </StandaloneAppBar>
      {shouldShowUsageGuide(app.id) ? (
        <AppUsageGuide app={app} variant="pane" />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {app.external ? (
          <ExternalAppFrame config={app.external} appName={app.name} />
        ) : app.microFrontend ? (
          <MicroAppLoader config={app.microFrontend} appId={app.id} framework="react" />
        ) : null}
      </div>
    </div>
  );
}
