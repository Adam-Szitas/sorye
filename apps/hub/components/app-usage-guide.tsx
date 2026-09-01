'use client';

import type { AppCatalogEntry } from '@sorye/types';
import { useEffect, useState } from 'react';

const STORAGE_PREFIX = 'sorye:app-intro-dismissed:';

function storageKey(appId: string) {
  return `${STORAGE_PREFIX}${appId}`;
}

interface AppUsageGuideProps {
  app: AppCatalogEntry;
  /** Compact card for the App Library picker. */
  variant?: 'pane' | 'picker';
}

export function AppUsageGuide({ app, variant = 'pane' }: AppUsageGuideProps) {
  const intro = app.usageIntro;
  const [dismissed, setDismissed] = useState(variant === 'picker');
  const [open, setOpen] = useState(variant === 'pane');

  useEffect(() => {
    if (variant !== 'pane') return;
    try {
      setDismissed(localStorage.getItem(storageKey(app.id)) === '1');
    } catch {
      setDismissed(false);
    }
    setOpen(true);
  }, [app.id, variant]);

  if (variant === 'picker') {
    return (
      <details className="mt-2 rounded-lg border border-white/8 bg-black/20 px-2.5 py-2 text-left">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-[var(--color-accent)] marker:content-none [&::-webkit-details-marker]:hidden">
          How to use →
        </summary>
        <p className="mt-1.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
          {intro.summary}
        </p>
        <ol className="mt-1.5 list-decimal space-y-1 pl-3.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
          {intro.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
    );
  }

  if (dismissed || !open) {
    return (
      <div className="shrink-0 border-b border-white/8 px-3 py-1.5">
        <button
          type="button"
          className="text-[11px] text-[var(--color-text-muted)] transition hover:text-[var(--color-accent)]"
          onClick={() => {
            setDismissed(false);
            setOpen(true);
            try {
              localStorage.removeItem(storageKey(app.id));
            } catch {
              // ignore
            }
          }}
        >
          How to use {app.name} →
        </button>
      </div>
    );
  }

  return (
    <aside
      className="shrink-0 border-b border-white/8 bg-[var(--color-surface-overlay)]/80 px-3 py-2.5"
      aria-label={`How to use ${app.name}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
            How to use
          </p>
          <p className="mt-0.5 text-xs leading-snug text-[var(--color-text)]">
            {intro.summary}
          </p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-3.5 text-[11px] leading-snug text-[var(--color-text-muted)]">
            {intro.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(storageKey(app.id), '1');
            } catch {
              // ignore
            }
          }}
        >
          Got it
        </button>
      </div>
    </aside>
  );
}
