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

const TRY_ACTION_CLASS =
  'inline-flex min-h-9 items-center rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-xs font-medium text-[var(--color-surface)] transition hover:brightness-110';

const EMAIL_ACTION_CLASS =
  'inline-flex min-h-9 items-center rounded-lg border border-white/15 px-3.5 py-2 text-xs font-medium text-[var(--color-text-muted)] transition hover:bg-white/8 hover:text-[var(--color-text)]';

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
    <div className="@container flex min-h-0 flex-1 flex-col overflow-auto p-4 sm:p-6">
      <article
        className={`mx-auto w-full ${alone ? 'max-w-6xl' : 'max-w-3xl'}`}
      >
        <header className="mb-8">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            {contactCopy.location}
          </p>
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {contactCopy.name}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {contactCopy.role}
          </p>
          <p
            className={`mt-3 text-pretty text-sm text-[var(--color-text-muted)] ${
              alone ? 'max-w-3xl' : 'max-w-xl'
            }`}
          >
            {contactCopy.offer}
          </p>
          <p
            className={`mt-4 text-pretty text-sm leading-relaxed text-[var(--color-text)] ${
              alone ? 'max-w-3xl' : 'max-w-xl'
            }`}
          >
            {contactCopy.intro}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={TRY_ACTION_CLASS}
              onClick={() => tryApp('protocolio')}
            >
              Try Protocolio
            </button>
            <button
              type="button"
              className={TRY_ACTION_CLASS}
              onClick={() => tryApp('canvas')}
            >
              Try Canvas
            </button>
            <ContactEmailDialog
              triggerClassName={EMAIL_ACTION_CLASS}
              triggerLabel="Email"
            />
          </div>
        </header>

        <section
          className="mb-10 grid gap-3 @[40rem]:grid-cols-2"
          aria-label="Live apps"
        >
          {featured.map((app) => (
            <button
              key={app.id}
              type="button"
              className="surface flex flex-col items-start gap-2 rounded-xl p-5 text-left transition hover:border-white/20 hover:bg-white/4"
              onClick={() => tryApp(app.id)}
            >
              <span className="flex w-full items-center justify-between">
                <AppIcon app={app} size="sm" />
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300">
                  Live
                </span>
              </span>
              <strong className="text-base font-semibold tracking-tight">
                {app.name}
              </strong>
              <span className="text-pretty text-sm text-[var(--color-text-muted)]">
                {app.usageIntro.summary}
              </span>
              <em className="mt-auto text-xs not-italic text-[var(--color-accent)]">
                Open {app.name}
              </em>
            </button>
          ))}
        </section>

        <ul className="mb-10 list-none space-y-0 p-0">
          {contactCopy.offers.map((offer) => (
            <li
              key={offer.title}
              className="grid gap-1 border-b border-white/8 py-3 text-sm text-[var(--color-text-muted)] first:pt-0"
            >
              <strong className="text-[var(--color-text)]">{offer.title}</strong>
              <span className="text-pretty">{offer.blurb}</span>
            </li>
          ))}
        </ul>

        <div className="mb-8 grid gap-4 @[36rem]:grid-cols-3">
          {contactCopy.caseStudies.map((study) => (
            <article
              key={study.title}
              className="border-t border-white/8 pt-3"
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
                {study.kicker}
              </p>
              <h2 className="mt-1 text-sm font-semibold tracking-tight">
                {study.title}
              </h2>
              <p className="mt-1 text-pretty text-sm text-[var(--color-text-muted)]">
                {study.summary}
              </p>
            </article>
          ))}
        </div>

        <div className="text-sm text-[var(--color-text-muted)]">
          Email{' '}
          <ContactEmailDialog
            triggerClassName="text-[var(--color-accent)] underline-offset-2 hover:underline"
            triggerLabel={contactCopy.email}
          />
        </div>
      </article>
    </div>
  );
}
