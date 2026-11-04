import type { CSSProperties } from 'react';
import { APP_CATALOG, type AppCatalogEntry } from '@sorye/types';
import { AppIcon } from '@/components/app-icon';
import { landingLocales, type LandingLocale } from '@/lib/app-landing-translations';
import styles from './app-landing-page.module.css';

const LANGUAGE_NAMES: Record<LandingLocale, string> = {
  en: 'English',
  de: 'Deutsch',
  sk: 'Slovenčina',
  hu: 'Magyar',
  es: 'Español',
};

const SURFACE_INK = '#0b0f17';

type LandingCopy = { summary: string; steps: readonly string[] };

type LandingLabels = readonly [string, string, string, string, string, string, string, string, string];

type AccentStyle = CSSProperties & {
  '--learn-accent': string;
  '--learn-on-accent': '#0b0f17' | '#ffffff';
};

type ChipStyle = CSSProperties & {
  '--chip-accent': string;
};

interface AppLandingPageProps {
  app: AppCatalogEntry;
  copy: LandingCopy;
  locale: LandingLocale;
  labels: LandingLabels;
}

function linearChannel(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = linearChannel((value >> 16) & 255);
  const green = linearChannel((value >> 8) & 255);
  const blue = linearChannel(value & 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Dark surface ink on light accents, white on dark accents. */
function inkForAccent(hex: string): '#0b0f17' | '#ffffff' {
  if (!/^#[\da-f]{6}$/i.test(hex)) return SURFACE_INK;
  const background = relativeLuminance(hex);
  const dark = relativeLuminance(SURFACE_INK);
  const whiteContrast = 1.05 / (background + 0.05);
  const darkContrast = (background + 0.05) / (dark + 0.05);
  return whiteContrast > darkContrast ? '#ffffff' : SURFACE_INK;
}

export function AppLandingPage({ app, copy, locale, labels }: AppLandingPageProps) {
  const footnote = app.presentationOnly ? labels[7] : app.adminOnly ? labels[6] : labels[5];
  const accentStyle: AccentStyle = {
    '--learn-accent': app.color,
    '--learn-on-accent': inkForAccent(app.color),
  };
  const others = APP_CATALOG.filter((item) => item.id !== app.id);

  return (
    <main lang={locale} className={styles.page} style={accentStyle}>
      <header className={`${styles.header} glass`}>
        <a href="/" className={styles.brand}>
          Sorye
        </a>
        <nav className={styles.siteNav} aria-label="Sorye">
          <a href="/contact">Contact</a>
          <a href="/architecture">Architecture</a>
          <a href="/login">Sign in</a>
          <a href="#apps">{labels[0]}</a>
        </nav>
      </header>

      <div className={styles.wrap}>
        <nav aria-label={labels[8]} className={styles.langs}>
          {landingLocales.map((code) => (
            <a
              key={code}
              href={`/learn/${app.slug}/${code}`}
              hrefLang={code}
              lang={code}
              aria-current={code === locale ? 'page' : undefined}
              className={styles.lang}
            >
              {LANGUAGE_NAMES[code]}
            </a>
          ))}
        </nav>

        <section className={styles.hero}>
          <p className={styles.kicker}>{labels[1]}</p>
          <div className={styles.titleRow}>
            <AppIcon app={app} size="lg" />
            <h1 className={styles.title}>{app.name}</h1>
          </div>
          <p className={styles.summary}>{copy.summary}</p>
          <a className={styles.cta} href={`https://sorye.app${app.mountPath}`}>
            {labels[2]} {app.name} →
          </a>
          <p className={styles.note}>{footnote}</p>
        </section>

        <section className={styles.block} aria-labelledby="how">
          <h2 id="how" className={styles.heading}>
            {labels[3]}
          </h2>
          <ol className={styles.steps}>
            {copy.steps.map((step, index) => (
              <li key={step} className={`${styles.step} surface`}>
                <span className={styles.stepIndex}>0{index + 1}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="apps" className={styles.block} aria-labelledby="more-tools">
          <h2 id="more-tools" className={styles.heading}>
            {labels[4]}
          </h2>
          <div className={styles.chips}>
            {others.map((item) => (
              <a
                key={item.id}
                className={styles.chip}
                href={`/learn/${item.slug}/${locale}`}
                style={{ '--chip-accent': item.color } as ChipStyle}
              >
                {item.name}
              </a>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
