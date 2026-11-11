'use client';

import { useId } from 'react';
import { usePathname } from 'next/navigation';
import { LANGUAGE_NAMES, LOCALES } from '@sorye/platform';
import { useI18n } from '@sorye/platform/react';

export function LanguageSelector({ placement = 'page' }: { placement?: 'page' | 'navbar' }) {
  const { locale, setLocale, t } = useI18n();
  const pathname = usePathname();
  const selectId = useId();
  if (pathname?.startsWith('/learn/')) return null;
  // Pages with StandaloneAppBar already carry a language switcher.
  if (placement === 'page' && (pathname === '/' || pathname?.startsWith('/apps/') || pathname?.startsWith('/admin') || pathname === '/pricing' || pathname === '/billing')) return null;

  const navbar = placement === 'navbar';

  return (
    <div className={navbar ? 'flex shrink-0 items-center gap-2' : 'flex items-center gap-2 p-2 text-sm'}>
      <label
        htmlFor={selectId}
        className={navbar ? 'text-xs text-[var(--color-text-muted)] [text-box:trim-both_cap_alphabetic]' : undefined}
      >
        {t('language')}
      </label>
      <select
        id={selectId}
        className="hub-language-select"
        autoComplete="language"
        value={locale}
        onChange={(event) => setLocale(event.target.value as typeof locale)}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_NAMES[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
