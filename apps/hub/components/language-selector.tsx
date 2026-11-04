'use client';
import { usePathname } from 'next/navigation';
import { LANGUAGE_NAMES, LOCALES } from '@sorye/platform';
import { useI18n } from '@sorye/platform/react';
export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  const pathname = usePathname();
  if (pathname?.startsWith('/learn/')) return null;
  return <label className="flex items-center gap-2 p-2 text-sm">{t('language')}<select className="rounded border border-slate-600 bg-slate-900 p-1 text-white" value={locale} onChange={event => setLocale(event.target.value as typeof locale)}>{LOCALES.map(code => <option key={code} value={code}>{LANGUAGE_NAMES[code]}</option>)}</select></label>;
}
