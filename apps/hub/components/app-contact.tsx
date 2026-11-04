'use client';

import { APP_CATALOG, type AppCatalogEntry } from '@sorye/types';
import { AppIcon } from '@/components/app-icon';
import { requestHubOpenApp } from '@/components/app-catalog';
import { ContactEmailDialog } from '@/components/contact-email-dialog';
import { contactCopy } from '@/lib/contact-copy';

const FEATURED_IDS = ['protocolio', 'canvas'] as const;

function featuredApps(): AppCatalogEntry[] {
  return FEATURED_IDS.map((id) => APP_CATALOG.find((app) => app.id === id)).filter(
    (app): app is AppCatalogEntry => Boolean(app),
  );
}

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]';

const TRY_ACTION_CLASS = `inline-flex min-h-12 items-center rounded-xl bg-[var(--color-accent)] px-5 text-sm font-medium text-[var(--color-surface)] transition hover:brightness-110 ${FOCUS_RING}`;

const EMAIL_ACTION_CLASS = `inline-flex min-h-12 items-center rounded-xl border border-white/15 px-5 text-sm font-medium text-[var(--color-text)] transition hover:bg-white/8 ${FOCUS_RING}`;

const TRY_ACTION_COMPACT =
  'inline-flex min-h-9 items-center rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-xs font-medium text-[var(--color-surface)] transition hover:brightness-110';

const EMAIL_ACTION_COMPACT =
  'inline-flex min-h-9 items-center rounded-lg border border-white/15 px-3.5 py-2 text-xs font-medium text-[var(--color-text)] transition hover:bg-white/8';

interface AppContactProps {
  paneSide?: 'left' | 'right';
  /** Full pane — widen the column. Split view keeps a tighter readable measure. */
  alone?: boolean;
}

function isStandaloneContactPage(): boolean {
  const path = window.location.pathname;
  return path === '/contact' || path.startsWith('/contact/') || path.startsWith('/apps/');
}

export function AppContact({ paneSide, alone = true }: AppContactProps) {
  const featured = featuredApps();
  const tryActionClass = alone ? TRY_ACTION_CLASS : TRY_ACTION_COMPACT;
  const emailActionClass = alone ? EMAIL_ACTION_CLASS : EMAIL_ACTION_COMPACT;

  function tryApp(appId: string) {
    const app = APP_CATALOG.find((entry) => entry.id === appId);
    if (!app) return;
    if (isStandaloneContactPage()) {
      window.location.assign(app.mountPath);
      return;
    }
    const side: 'left' | 'right' =
      paneSide === 'left' ? 'right' : paneSide === 'right' ? 'left' : 'right';
    requestHubOpenApp(app.id, side);
  }

  return (
    <div
      className={`@container flex min-h-0 flex-1 flex-col overflow-auto ${
        alone ? 'px-6 py-16 sm:px-8 sm:py-20' : 'p-4 sm:p-6'
      }`}
    >
      <article className={`mx-auto w-full ${alone ? 'max-w-5xl' : 'max-w-3xl'}`}>
        <header className={alone ? 'mb-16 sm:mb-20' : 'mb-8'}>
          <p
            className={`font-medium uppercase text-[var(--color-accent)] ${
              alone
                ? 'mb-4 text-sm tracking-widest'
                : 'mb-2 text-[11px] tracking-[0.12em]'
            }`}
          >
            {contactCopy.location}
          </p>
          <h1
            className={`text-balance font-semibold tracking-tight text-[var(--color-text)] ${
              alone ? 'text-5xl sm:text-6xl' : 'text-3xl sm:text-4xl'
            }`}
          >
            {contactCopy.name}
          </h1>
          <p
            className={`text-[var(--color-text-muted)] ${
              alone ? 'mt-5 text-lg sm:text-xl' : 'mt-1 text-sm'
            }`}
          >
            {contactCopy.role}
          </p>
          <p
            className={`text-pretty leading-relaxed text-[var(--color-text)] ${
              alone
                ? 'mt-8 max-w-3xl text-xl sm:text-2xl'
                : 'mt-3 max-w-xl text-sm'
            }`}
          >
            {contactCopy.offer}
          </p>
          <p
            className={`text-pretty leading-relaxed text-[var(--color-text-muted)] ${
              alone
                ? 'mt-6 max-w-3xl text-base sm:text-lg'
                : 'mt-4 max-w-xl text-sm'
            }`}
          >
            {contactCopy.intro}
          </p>
          <div
            className={`flex flex-wrap items-center ${alone ? 'mt-10 gap-3' : 'mt-5 gap-2'}`}
          >
            <button
              type="button"
              className={tryActionClass}
              onClick={() => tryApp('protocolio')}
            >
              Try Protocolio
            </button>
            <button type="button" className={tryActionClass} onClick={() => tryApp('canvas')}>
              Try Canvas
            </button>
            <ContactEmailDialog
              triggerClassName={emailActionClass}
              triggerLabel="Email"
            />
          </div>
        </header>

        <section
          className={`grid ${alone ? 'mb-20 gap-6' : 'mb-10 gap-3'} @[40rem]:grid-cols-2`}
          aria-label="Live apps"
        >
          {featured.map((app) => (
            <button
              key={app.id}
              type="button"
              className={`surface flex flex-col items-start text-left transition hover:border-white/20 hover:bg-white/4 ${FOCUS_RING} ${
                alone ? 'gap-4 rounded-2xl p-6 sm:p-8' : 'gap-2 rounded-xl p-5'
              }`}
              onClick={() => tryApp(app.id)}
            >
              <span className="flex w-full items-center justify-between gap-4">
                <AppIcon app={app} size={alone ? 'md' : 'sm'} />
                <span className="rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-accent)]">
                  Live
                </span>
              </span>
              <strong
                className={`font-semibold tracking-tight text-[var(--color-text)] ${
                  alone ? 'text-xl' : 'text-base'
                }`}
              >
                {app.name}
              </strong>
              <span
                className={`text-pretty leading-relaxed text-[var(--color-text-muted)] ${
                  alone ? 'text-base' : 'text-sm'
                }`}
              >
                {app.usageIntro.summary}
              </span>
              <em
                className={`mt-auto not-italic text-[var(--color-accent)] ${
                  alone ? 'pt-2 text-sm' : 'text-xs'
                }`}
              >
                Open {app.name}
              </em>
            </button>
          ))}
        </section>

        <ul className={`list-none p-0 ${alone ? 'mb-20' : 'mb-10'}`}>
          {contactCopy.offers.map((offer) => (
            <li
              key={offer.title}
              className={`grid border-b border-white/8 text-[var(--color-text-muted)] first:pt-0 ${
                alone ? 'gap-2 py-6 text-base leading-relaxed' : 'gap-1 py-3 text-sm'
              }`}
            >
              <strong
                className={`text-[var(--color-text)] ${alone ? 'text-lg font-semibold' : ''}`}
              >
                {offer.title}
              </strong>
              <span className="text-pretty">{offer.blurb}</span>
            </li>
          ))}
        </ul>

        <div
          className={`grid ${alone ? 'mb-16 gap-6 @[48rem]:grid-cols-3' : 'mb-8 gap-4 @[36rem]:grid-cols-3'}`}
        >
          {contactCopy.caseStudies.map((study) => (
            <article
              key={study.title}
              className={
                alone
                  ? 'surface rounded-2xl p-6 sm:p-8'
                  : 'border-t border-white/8 pt-3'
              }
            >
              <p
                className={`font-medium uppercase text-[var(--color-accent)] ${
                  alone ? 'text-xs tracking-widest' : 'text-[11px] tracking-[0.12em]'
                }`}
              >
                {study.kicker}
              </p>
              <h2
                className={`font-semibold tracking-tight text-[var(--color-text)] ${
                  alone ? 'mt-3 text-xl' : 'mt-1 text-sm'
                }`}
              >
                {study.title}
              </h2>
              <p
                className={`text-pretty leading-relaxed text-[var(--color-text-muted)] ${
                  alone ? 'mt-3 text-base' : 'mt-1 text-sm'
                }`}
              >
                {study.summary}
              </p>
            </article>
          ))}
        </div>

        <p className={`text-[var(--color-text-muted)] ${alone ? 'text-base' : 'text-sm'}`}>
          Email{' '}
          <ContactEmailDialog
            triggerClassName={`text-[var(--color-accent)] underline-offset-2 hover:underline ${FOCUS_RING}`}
            triggerLabel={contactCopy.email}
          />
        </p>
      </article>
    </div>
  );
}
