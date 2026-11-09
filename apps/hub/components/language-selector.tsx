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
  if (placement === 'page' && (pathname === '/' || pathname?.startsWith('/apps/'))) return null;

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
        className={
          navbar
            ? 'rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]'
            : 'rounded border border-slate-600 bg-slate-900 p-1 text-white'
        }
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
