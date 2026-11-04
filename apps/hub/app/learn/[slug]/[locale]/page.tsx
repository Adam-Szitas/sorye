import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { APP_CATALOG } from '@sorye/types';
import { AppLandingPage } from '@/components/app-landing-page';
import {
  landingLocales,
  landingLabels,
  localizedLandings,
  landingUrl,
  type LandingLocale,
} from '@/lib/app-landing-translations';

export function generateStaticParams() {
  return APP_CATALOG.flatMap(({ slug }) => landingLocales.map((locale) => ({ slug, locale })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}): Promise<Metadata> {
  const { slug, locale: input } = await params;
  if (input === 'esp') redirect(`/learn/${slug}/es`);
  if (!landingLocales.includes(input as LandingLocale)) notFound();
  const locale = input as LandingLocale;
  const landings = localizedLandings[locale];
  const app = APP_CATALOG.find((entry) => entry.slug === slug);
  if (!app) return {};
  const description = landings[app.id]?.summary;
  const canonical = landingUrl(app.slug, locale);
  const title = `${app.name} | Sorye`;
  return {
    title,
    description,
    alternates: {
      canonical,
      languages: Object.fromEntries([
        ...landingLocales.map((code) => [code, landingUrl(app.slug, code)]),
        ['x-default', landingUrl(app.slug, 'en')],
      ]),
    },
    openGraph: { title, description, url: canonical, type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function Landing({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}) {
  const { slug, locale: input } = await params;
  if (input === 'esp') redirect(`/learn/${slug}/es`);
  if (!landingLocales.includes(input as LandingLocale)) notFound();
  const locale = input as LandingLocale;
  const landings = localizedLandings[locale];
  const app = APP_CATALOG.find((entry) => entry.slug === slug);
  if (!app || !landings[app.id]) notFound();
  return (
    <AppLandingPage app={app} copy={landings[app.id]} locale={locale} labels={landingLabels[locale]} />
  );
}
