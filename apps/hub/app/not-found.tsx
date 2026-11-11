'use client';

import { useI18n } from '@sorye/platform/react';
import { StatusPage } from '@/components/status-page';

export default function NotFound() {
  const { t, locale } = useI18n();
  return (
    <StatusPage
      lang={locale}
      code="404"
      title={t('status.notFound.title')}
      body={t('status.notFound.body')}
      actions={[
        { kind: 'button', label: t('status.goBack'), onClick: () => window.history.back() },
        { kind: 'link', href: '/', label: t('status.goHub'), primary: true },
      ]}
    />
  );
}
