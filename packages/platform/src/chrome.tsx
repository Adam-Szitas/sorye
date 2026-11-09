import { useId, useSyncExternalStore, type ReactNode } from 'react';
import {
  LANGUAGE_NAMES,
  LOCALES,
  getLocale,
  setLocale,
  subscribeLocale,
  translate,
  type Locale,
} from './i18n';

/**
 * Navbar for a document that is not the Hub shell.
 * Shell apps use `apps/hub/components/top-bar.tsx` instead.
 */
const CHROME_CSS = `
.sorye-standalone {
  display: flex;
  flex-direction: column;
  block-size: 100dvh;
  background: #0b0f17;
  color: #f1f5f9;
}
.sorye-standalone > :not(.sorye-app-bar) {
  flex: 1 1 auto;
  min-block-size: 0;
}
.sorye-app-bar {
  position: sticky;
  inset-block-start: 0;
  z-index: 40;
  display: flex;
  flex-wrap: wrap;
  flex-wrap: balance;
  align-items: safe center;
  justify-content: space-between;
  column-gap: 1rem;
  row-gap: 0.5rem;
  flex-shrink: 0;
  padding-block: 0.75rem;
  padding-inline: 1rem;
  background: #121826;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f1f5f9;
  color-scheme: dark;
  font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
}
@media (min-width: 40rem) {
  .sorye-app-bar { padding-inline: 2rem; }
}
@media (min-width: 48rem) {
  .sorye-app-bar {
    background: rgba(18, 24, 38, 0.85);
    backdrop-filter: blur(12px) saturate(1.2);
  }
}
@media (prefers-reduced-transparency: reduce) {
  .sorye-app-bar {
    background: #121826;
    backdrop-filter: none;
  }
}
.sorye-app-bar-brand {
  display: flex;
  align-items: safe center;
  gap: 0.75rem;
  min-inline-size: 0;
}
.sorye-app-bar-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  inline-size: 2rem;
  block-size: 2rem;
  border-radius: 0.5rem;
  background: #38bdf8;
  color: #0b0f17;
  font-weight: 700;
}
.sorye-app-bar-title,
.sorye-app-bar-sub { margin: 0; }
.sorye-app-bar-title {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1;
}
.sorye-app-bar-sub {
  margin-block-start: 0.15rem;
  font-size: 0.6875rem;
  color: #94a3b8;
}
.sorye-app-bar-actions,
.sorye-app-bar-lang {
  display: flex;
  flex-wrap: wrap;
  flex-wrap: balance;
  align-items: safe center;
}
.sorye-app-bar-actions {
  justify-content: flex-end;
  gap: 0.5rem;
  max-inline-size: 100%;
}
@media (min-width: 40rem) {
  .sorye-app-bar-actions { gap: 0.75rem; }
}
.sorye-app-bar-hub,
.sorye-app-bar-lang { flex-shrink: 0; }
.sorye-app-bar-hub {
  border-radius: 0.5rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  color: #94a3b8;
  text-decoration: none;
}
.sorye-app-bar-hub:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
}
.sorye-app-bar-lang { gap: 0.5rem; }
.sorye-app-bar-lang label {
  font-size: 0.75rem;
  color: #94a3b8;
  text-box: trim-both cap alphabetic;
}
.sorye-app-bar-lang select {
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #f1f5f9;
  padding: 0.375rem 0.5rem;
  font-size: 0.75rem;
}
.sorye-app-bar-hub:focus-visible,
.sorye-app-bar-lang select:focus-visible {
  outline: 2px solid #38bdf8;
  outline-offset: 2px;
}
`;

function configuredHubOrigin(): string | undefined {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const value = env?.VITE_HUB_ORIGIN?.trim();
  return value || undefined;
}

/** Hub menu URL. `/` on the Hub origin; the Hub origin when this document is a remote port. */
export function hubMenuHref(): string {
  if (typeof window === 'undefined') return '/';
  const configured = configuredHubOrigin();
  if (configured) {
    try {
      const origin = new URL(configured).origin;
      if (window.location.origin === origin) return '/';
      return `${origin}/`;
    } catch {
      /* Use the same-origin menu when the configured origin is not a URL. */
    }
  }
  return '/';
}

export function StandaloneAppBar({
  appName,
  children,
}: {
  appName?: string;
  children?: ReactNode;
}) {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => 'en' as const);
  const selectId = useId();
  return (
    <header className="sorye-app-bar">
      <style>{CHROME_CSS}</style>
      <div className="sorye-app-bar-brand">
        <div className="sorye-app-bar-mark" aria-hidden="true">S</div>
        <div>
          <p className="sorye-app-bar-title">Sorye</p>
          <p className="sorye-app-bar-sub">{appName ?? 'Hub OS'}</p>
        </div>
      </div>
      <div className="sorye-app-bar-actions">
        {children}
        <a className="sorye-app-bar-hub" href={hubMenuHref()}>Hub</a>
        <div className="sorye-app-bar-lang">
          <label htmlFor={selectId}>{translate(locale, 'language')}</label>
          <select
            id={selectId}
            autoComplete="language"
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
          >
            {LOCALES.map((code) => (
              <option key={code} value={code}>{LANGUAGE_NAMES[code]}</option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}

/** Vite `main.tsx` wrapper. Hub `mount()` does not use this — the shell bar is already there. */
export function StandaloneFrame({
  appName,
  children,
}: {
  appName: string;
  children: ReactNode;
}) {
  return (
    <div className="sorye-standalone">
      <StandaloneAppBar appName={appName} />
      {children}
    </div>
  );
}
