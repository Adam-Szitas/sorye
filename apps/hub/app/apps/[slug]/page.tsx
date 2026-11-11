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
import { useI18n } from '@sorye/platform/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StatusPage } from '@/components/status-page';
import NotFound from '@/app/not-found';

/** Why the app is not shown: the access check failed, or the app is not on this workspace. */
type Denied = 'not-on-workspace' | 'check-failed';

export default function MicroAppPage() {
  const params = useParams<{ slug: string }>();
  const { t, locale } = useI18n();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [denied, setDenied] = useState<Denied>('not-on-workspace');
  const [attempt, setAttempt] = useState(0);
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
      // A failed check is not the same as "not on your workspace": say so and offer a retry.
      const res = await fetch('/api/workspace', { credentials: 'include', cache: 'no-store' }).catch(() => null);
      if (!res || !res.ok) {
        setDenied('check-failed');
        setAllowed(false);
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data?.workspace) {
        setDenied('check-failed');
        setAllowed(false);
        return;
      }
      setDenied('not-on-workspace');
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
  }, [params.slug, attempt]);

  if (allowed === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
      </div>
    );
  }

  if (!app) return <NotFound />;

  if (!allowed) {
    if (denied === 'check-failed') {
      return (
        <StatusPage
          lang={locale}
          code="503"
          title={t('status.checkFailed.title')}
          body={t('status.checkFailed.body')}
          actions={[
            { kind: 'link', href: '/', label: t('status.goHub') },
            { kind: 'button', label: t('status.tryAgain'), primary: true, onClick: () => { setAllowed(null); setAttempt((n) => n + 1); } },
          ]}
        />
      );
    }
    return (
      <StatusPage
        lang={locale}
        code="403"
        title={t('status.appUnavailable.title')}
        body={t('status.appUnavailable.body')}
        hint={t('status.appUnavailable.hint')}
        actions={[
          { kind: 'link', href: '/billing', label: t('status.seePlans') },
          { kind: 'link', href: '/', label: t('status.goHub'), primary: true },
        ]}
      />
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
