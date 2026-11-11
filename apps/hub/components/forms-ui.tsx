import type { FormFieldKind } from '@sorye/types';
import type { ReactNode } from 'react';

/** Shared look for the Forms builder, answers and public page. */
export const INPUT_CLASS =
  'w-full min-h-11 rounded-[0.625rem] border border-white/12 bg-[var(--color-surface-overlay)] px-3 py-2 text-base text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-text-muted)]/70 hover:border-white/20 focus-visible:border-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]/40 aria-[invalid=true]:border-red-400';
export const LABEL_CLASS = 'block text-sm font-medium text-[var(--color-text)]';
export const HINT_CLASS = 'mt-1.5 text-xs leading-relaxed text-[var(--color-text-muted)]';
export const CARD_CLASS = 'rounded-2xl border border-white/10 bg-[var(--color-surface-raised)]/80 p-4 sm:p-5';
export const GHOST_BTN =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-white/8 hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-40';
export const ICON_BTN =
  'inline-flex size-10 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition-colors hover:bg-white/8 hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-30';
export const PRIMARY_BTN =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-5 text-sm font-semibold text-slate-950 shadow-[0_1px_0_rgba(255,255,255,0.25)_inset] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-50';
export const DANGER_BTN =
  'inline-flex min-h-10 items-center justify-center rounded-lg border border-red-400/30 px-3 text-sm text-red-300 transition-colors hover:bg-red-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300 disabled:pointer-events-none disabled:opacity-40';

function Svg({ children, className = 'size-4' }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const Icon = {
  up: (p: { className?: string }) => <Svg {...p}><path d="m18 15-6-6-6 6" /></Svg>,
  down: (p: { className?: string }) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>,
  trash: (p: { className?: string }) => <Svg {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>,
  copy: (p: { className?: string }) => <Svg {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Svg>,
  check: (p: { className?: string }) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>,
  external: (p: { className?: string }) => <Svg {...p}><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /></Svg>,
  plus: (p: { className?: string }) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>,
  refresh: (p: { className?: string }) => <Svg {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></Svg>,
  download: (p: { className?: string }) => <Svg {...p}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></Svg>,
  lock: (p: { className?: string }) => <Svg {...p}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>,
  inbox: (p: { className?: string }) => <Svg {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" /></Svg>,
  alert: (p: { className?: string }) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></Svg>,
} as const;

/** Small glyph per question type, shown in the add-question palette and on field cards. */
export function KindGlyph({ kind, className = 'size-4' }: { kind: FormFieldKind; className?: string }) {
  switch (kind) {
    case 'text': return <Svg className={className}><path d="M4 7h16M4 12h10" /></Svg>;
    case 'textarea': return <Svg className={className}><path d="M4 6h16M4 10h16M4 14h16M4 18h9" /></Svg>;
    case 'email': return <Svg className={className}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></Svg>;
    case 'phone': return <Svg className={className}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></Svg>;
    case 'number': return <Svg className={className}><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></Svg>;
    case 'date': return <Svg className={className}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Svg>;
    case 'select': return <Svg className={className}><circle cx="12" cy="12" r="9" /><path d="m8 11 4 4 4-4" /></Svg>;
    case 'multiselect': return <Svg className={className}><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" /></Svg>;
    case 'checkbox': return <Svg className={className}><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></Svg>;
    case 'consent': return <Svg className={className}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></Svg>;
  }
}
