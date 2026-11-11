'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Minimal full-screen status page (404, app not available, access check failed).
 * The 503 page from the middleware mirrors this look in plain HTML
 * (lib/unavailable-page.ts) because it renders before React is available.
 */

export type StatusAction =
  | { kind: 'link'; href: string; label: string; primary?: boolean }
  | { kind: 'button'; onClick: () => void; label: string; primary?: boolean };

const BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]';
const PRIMARY = `${BUTTON} bg-[var(--color-accent)] text-slate-950 hover:brightness-110`;
const SECONDARY = `${BUTTON} border border-white/12 text-[var(--color-text)] hover:bg-white/[0.06]`;

export function StatusPage({ code, title, body, hint, actions, lang }: {
  /** Large faint label above the title, e.g. "404". */
  code: string;
  title: string;
  body: string;
  hint?: ReactNode;
  actions: StatusAction[];
  lang?: string;
}) {
  return (
    <main lang={lang} className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.14),transparent_62%)]"
      />
      <div className="status-rise relative flex w-full max-w-md flex-col items-center text-center">
        <Link href="/" aria-label="Sorye" className="mb-10 inline-flex size-10 items-center justify-center rounded-xl bg-[var(--color-accent)] text-base font-bold text-slate-950 shadow-[0_8px_30px_-8px_rgba(56,189,248,0.6)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent)]">
          S
        </Link>
        <p aria-hidden="true" className="select-none bg-gradient-to-b from-white/70 to-white/[0.04] bg-clip-text text-[6.5rem] font-semibold leading-none tracking-tighter text-transparent sm:text-[8rem]">
          {code}
        </p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="mt-3 text-base leading-relaxed text-[var(--color-text-muted)] text-pretty">{body}</p>
        {hint ? <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]/80 text-pretty">{hint}</p> : null}
        <div className="mt-8 flex w-full flex-col-reverse gap-3 sm:w-auto sm:flex-row sm:justify-center">
          {actions.map((action) => {
            const className = action.primary ? PRIMARY : SECONDARY;
            return action.kind === 'link' ? (
              <Link key={action.label} href={action.href} className={className}>{action.label}</Link>
            ) : (
              <button key={action.label} type="button" onClick={action.onClick} className={className}>{action.label}</button>
            );
          })}
        </div>
      </div>
    </main>
  );
}
