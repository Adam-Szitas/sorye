import type { MetadataRoute } from 'next';
import { APP_CATALOG } from '@sorye/types';
import { landingLocales, landingUrl } from '@/lib/app-landing-translations';
export default function sitemap(): MetadataRoute.Sitemap {
  return APP_CATALOG.flatMap(app => landingLocales.map(locale => ({ url: landingUrl(app.slug, locale), alternates: { languages: Object.fromEntries(landingLocales.map(code => [code, landingUrl(app.slug, code)])) } })));
}
