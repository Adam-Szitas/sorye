import { bestLocale, localeBase } from './routing';
import {
  isSiteLocale, markdownToText, textFor,
  type CmsPage, type FormState, type MediaInfo, type NavLink, type PublicProduct, type RenderContext,
  type SiteCollection, type SiteCollectionItem, type SiteLocale, type SiteSection, type SiteSettings,
} from '@sorye/site-sdk';
import { pageTitle, renderDocument, siteCsp, type RenderedDocument } from '@sorye/site-sdk/render';
import { formatStorefrontPrice } from '@sorye/types';

/**
 * Turns a site (published revision or owner draft) plus a URL into a rendered page.
 * Shared by the public renderer (`/s/{slug}/...`) and the owner preview, so a preview
 * is exactly what publishing will serve.
 */
export interface SiteSource {
  slug: string;
  settings: SiteSettings;
  pages: Array<Pick<CmsPage, 'id' | 'slug' | 'title' | 'nav' | 'order' | 'seo'>>;
  collections: SiteCollection[];
  products: PublicProduct[];
  media: (id: string) => MediaInfo | undefined;
  loadPage: (pageId: string) => Promise<CmsPage | null>;
  loadItems: (collection: SiteCollection) => Promise<SiteCollectionItem[]>;
}

export type Route =
  | { kind: 'page'; locale: SiteLocale; pageId: string }
  | { kind: 'item'; locale: SiteLocale; collection: SiteCollection; itemSlug: string }
  | { kind: 'notFound'; locale: SiteLocale };

/** `[locale]`, `[locale, page]` or `[locale, collection, item]`. */
export function resolveRoute(source: SiteSource, segments: string[]): Route {
  const settings = source.settings;
  const [first, second, third, ...rest] = segments;
  const locale = first && isSiteLocale(first) && settings.locales.includes(first) ? first : null;
  if (!locale || rest.length > 0) return { kind: 'notFound', locale: locale ?? settings.defaultLocale };
  if (second === undefined) return { kind: 'page', locale, pageId: settings.homePageId };
  if (third === undefined) {
    const page = source.pages.find((p) => p.slug === second);
    if (page && page.id === settings.homePageId) return { kind: 'notFound', locale };
    return page ? { kind: 'page', locale, pageId: page.id } : { kind: 'notFound', locale };
  }
  const collection = source.collections.find((c) => c.slug === second && c.detailPages);
  return collection ? { kind: 'item', locale, collection, itemSlug: third } : { kind: 'notFound', locale };
}

export { bestLocale, localeBase };

export function pagePath(source: SiteSource, locale: SiteLocale, pageId: string): string {
  const base = localeBase(source.slug, locale);
  if (pageId === source.settings.homePageId) return base;
  const page = source.pages.find((p) => p.id === pageId);
  return page ? `${base}/${page.slug}` : base;
}

function nav(source: SiteSource, locale: SiteLocale, currentId: string | null): RenderContext['nav'] {
  const sorted = [...source.pages].sort((a, b) => a.order - b.order);
  const link = (p: (typeof sorted)[number]): NavLink => ({
    href: pagePath(source, locale, p.id),
    label: textFor(p.title, locale, source.settings.defaultLocale) || p.slug,
    current: p.id === currentId,
  });
  return {
    header: sorted.filter((p) => p.nav === 'header' || p.nav === 'both').map(link),
    footer: sorted.filter((p) => p.nav === 'footer' || p.nav === 'both').map(link),
  };
}

/** Items for every collection the sections show, plus the detail collection. */
async function itemsFor(source: SiteSource, sections: SiteSection[], extra?: SiteCollection) {
  const ids = new Set<string>();
  for (const s of sections) {
    if ((s.type === 'collectionList' || s.type === 'collectionItem') && typeof s.props.collection === 'string') ids.add(s.props.collection);
  }
  if (extra) ids.add(extra.id);
  const loaded = new Map<string, SiteCollectionItem[]>();
  await Promise.all([...ids].map(async (id) => {
    const collection = source.collections.find((c) => c.id === id);
    if (collection) loaded.set(id, await source.loadItems(collection));
  }));
  return loaded;
}

export interface RenderInput {
  source: SiteSource;
  route: Route;
  origin: string;
  formAction: (pageId: string, sectionId: string) => string;
  formToken: string;
  formState?: FormState;
  preview: boolean;
}

export interface RenderResult extends RenderedDocument { status: 200 | 404; csp: string }

function alternates(source: SiteSource, origin: string, path: (locale: SiteLocale) => string): Array<{ locale: SiteLocale | 'x-default'; href: string }> {
  const list = source.settings.locales.map((locale) => ({ locale, href: `${origin}${path(locale)}` }));
  return [...list, { locale: 'x-default' as const, href: `${origin}${path(source.settings.defaultLocale)}` }];
}

export async function renderRoute(input: RenderInput): Promise<RenderResult> {
  const { source, route, origin } = input;
  const settings = source.settings;
  let page: CmsPage | null = null;
  let current: RenderContext['currentItem'];
  let status: 200 | 404 = 200;
  if (route.kind === 'page') page = await source.loadPage(route.pageId);
  let detailItems: SiteCollectionItem[] | undefined;
  if (route.kind === 'item') {
    detailItems = await source.loadItems(route.collection);
    const item = detailItems.find((i) => i.slug === route.itemSlug && i.status === 'published');
    if (item) current = { collection: route.collection, item };
  }
  const notFound = route.kind === 'notFound' || (route.kind === 'page' && !page) || (route.kind === 'item' && !current);
  const home = notFound || route.kind === 'item' ? await source.loadPage(settings.homePageId) : null;
  // Header and footer come from the home page so 404s and detail pages keep site chrome.
  const chrome = (home?.sections ?? []).filter((s) => s.type === 'header' || s.type === 'footer');
  let sections: SiteSection[];
  if (notFound) {
    status = 404;
    sections = [...chrome.filter((s) => s.type === 'header'), notFoundSection(route.locale), ...chrome.filter((s) => s.type === 'footer')];
  } else if (route.kind === 'item') {
    sections = [...chrome.filter((s) => s.type === 'header'), { id: 'item', type: 'collectionItem', version: 1, props: { collection: route.collection.id, itemSlug: {} } }, ...chrome.filter((s) => s.type === 'footer')];
  } else sections = page!.sections;

  const loaded = await itemsFor(source, sections, route.kind === 'item' ? route.collection : undefined);
  if (detailItems && route.kind === 'item') loaded.set(route.collection.id, detailItems);
  const locale = route.locale;
  const ctx: RenderContext = {
    settings, locale, basePath: localeBase(source.slug, locale), page: notFound ? null : page,
    nav: nav(source, locale, route.kind === 'page' && !notFound ? route.pageId : null),
    media: source.media, collections: source.collections, items: (id) => loaded.get(id) ?? [],
    ...(current ? { currentItem: current } : {}),
    products: source.products, formatPrice: formatStorefrontPrice,
    form: { action: (sectionId) => input.formAction(page?.id ?? settings.homePageId, sectionId), token: input.formToken, ...(input.formState ? { state: input.formState } : {}) },
    preview: input.preview,
  };
  const path = (l: SiteLocale) => route.kind === 'item' && current
    ? `${localeBase(source.slug, l)}/${route.collection.slug}/${current.item.slug}`
    : route.kind === 'page' && !notFound ? pagePath(source, l, route.pageId) : localeBase(source.slug, l);
  const title = notFound
    ? `404 · ${settings.name}`
    : current
      ? `${textFor(current.item.values[route.kind === 'item' ? route.collection.titleField : ''] as never, locale, settings.defaultLocale) || current.item.slug} · ${settings.name}`
      : pageTitle(ctx);
  const description = page ? textFor(page.seo.description, locale, settings.defaultLocale) || textFor(settings.seo.description, locale, settings.defaultLocale) : textFor(settings.seo.description, locale, settings.defaultLocale);
  const social = settings.socialImage ? source.media(settings.socialImage.id) : undefined;
  const favicon = settings.favicon ? source.media(settings.favicon.id) : undefined;
  const doc = renderDocument(ctx, sections, {
    title, description: markdownToText(description).slice(0, 300), canonical: `${origin}${path(locale)}`,
    alternates: notFound ? [] : alternates(source, origin, path),
    ...(social ? { socialImageUrl: `${origin}${social.url}` } : {}),
    ...(favicon ? { faviconUrl: favicon.url } : {}),
    noindex: notFound || input.preview, status,
  });
  return { ...doc, status, csp: siteCsp(doc.styleHashes) };
}

function notFoundSection(locale: SiteLocale): SiteSection {
  const text = { en: 'Page not found', de: 'Seite nicht gefunden', sk: 'Stránka sa nenašla', hu: 'Az oldal nem található', es: 'Página no encontrada' }[locale];
  return { id: 'not-found', type: 'cta', version: 1, props: { heading: { [locale]: text }, body: {}, ctaLabel: { [locale]: '←' }, ctaHref: '/', tone: 'subtle' } };
}

/** Per-site sitemap: every page and detail item in every enabled locale, with alternates. */
export async function renderSitemap(source: SiteSource, origin: string): Promise<string> {
  const urls: string[] = [];
  const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const entry = (path: (l: SiteLocale) => string) => {
    for (const locale of source.settings.locales) {
      const links = source.settings.locales.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${escape(origin + path(l))}"/>`).join('');
      urls.push(`<url><loc>${escape(origin + path(locale))}</loc>${links}</url>`);
    }
  };
  for (const page of source.pages) entry((l) => pagePath(source, l, page.id));
  for (const collection of source.collections.filter((c) => c.detailPages)) {
    const items = (await source.loadItems(collection)).filter((i) => i.status === 'published');
    for (const item of items) entry((l) => `${localeBase(source.slug, l)}/${collection.slug}/${item.slug}`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>`;
}

