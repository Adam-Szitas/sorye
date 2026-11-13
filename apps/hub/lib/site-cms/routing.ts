import { negotiateLocale, type SiteLocale, type SiteSettings } from '@sorye/site-sdk';

/**
 * URL helpers without the renderer, so pages that only redirect do not pull in
 * server rendering. Locale home is `/s/{slug}/{locale}` without a trailing slash
 * (Next.js redirects trailing slashes away).
 */
export function localeBase(slug: string, locale: SiteLocale) {
  return `/s/${slug}/${locale}`;
}

export function bestLocale(settings: SiteSettings, acceptLanguage: string | null): SiteLocale {
  return negotiateLocale(acceptLanguage, settings.locales, settings.defaultLocale);
}
