'use client';

import { AppCatalogBrowser } from '@/components/app-catalog';
import { AppContact } from '@/components/app-contact';
import { AppFiles } from '@/components/app-files';
import { AppMail } from '@/components/app-mail';
import { AppReports } from '@/components/app-reports';
import { AppSite } from '@/components/app-site';
import { AppStorefront } from '@/components/app-storefront';
import type { AppCatalogEntry } from '@sorye/types';

interface HubNativeAppBodyProps {
  app: AppCatalogEntry;
  paneSide?: 'left' | 'right';
  alone?: boolean;
}

export function HubNativeAppBody({
  app,
  paneSide,
  alone = true,
}: HubNativeAppBodyProps) {
  if (app.id === 'catalog') {
    return <AppCatalogBrowser paneSide={paneSide} />;
  }
  if (app.id === 'reports') {
    return <AppReports />;
  }
  if (app.id === 'storefront') {
    return <AppStorefront />;
  }
  if (app.id === 'site') {
    return <AppSite />;
  }
  if (app.id === 'contact') {
    return <AppContact paneSide={paneSide} alone={alone} />;
  }
  if (app.id === 'mail') {
    return <AppMail />;
  }
  if (app.id === 'files') {
    return <AppFiles />;
  }
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--color-text-muted)]">
      {app.name} is not available in this view yet.
    </div>
  );
}
