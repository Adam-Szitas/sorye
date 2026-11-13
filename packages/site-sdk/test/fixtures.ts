import type { RenderContext } from '../src/context';
import type { CmsPage, MediaInfo, SiteCollection, SiteCollectionItem, SiteSettings } from '../src/model';

export const NOW = '2026-11-13T10:00:00.000Z';

export function settings(overrides: Partial<SiteSettings> = {}): SiteSettings {
  return {
    id: 'site', slug: 'acme', name: 'Acme', theme: { preset: 'paper', overrides: {} }, logo: null, favicon: null, socialImage: null,
    defaultLocale: 'en', locales: ['en', 'de'], seo: { title: {}, description: { en: 'Acme makes things.' } }, homePageId: 'home', updatedAt: NOW,
    ...overrides,
  };
}

export const MEDIA: Record<string, MediaInfo> = {
  m1: { id: 'm1', url: '/s/acme/media/m1', width: 1200, height: 800, mimeType: 'image/jpeg', name: 'team.jpg' },
};

export const NEWS: SiteCollection = {
  id: 'news', slug: 'news', name: { en: 'News' }, titleField: 'title', sort: 'dateDesc', sortField: 'date', detailPages: true, updatedAt: NOW,
  fields: [
    { key: 'title', label: { en: 'Title' }, kind: 'text', required: true, options: [] },
    { key: 'date', label: { en: 'Date' }, kind: 'date', required: true, options: [] },
    { key: 'body', label: { en: 'Body' }, kind: 'richtext', required: false, options: [] },
  ],
};

export const ITEMS: SiteCollectionItem[] = [
  { id: 'n1', collectionId: 'news', slug: 'launch', status: 'published', order: 0, values: { title: { en: 'Launch', de: 'Start' }, date: '2026-10-01', body: { en: 'We **launched**.' } }, updatedAt: NOW },
  { id: 'n2', collectionId: 'news', slug: 'secret', status: 'draft', order: 1, values: { title: { en: 'Secret draft' }, date: '2026-11-01', body: {} }, updatedAt: NOW },
];

export function ctx(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    settings: settings(), locale: 'en', basePath: '/s/acme/en', page: null,
    nav: { header: [{ href: '/s/acme/en/about', label: 'About', current: false }], footer: [] },
    media: (id) => MEDIA[id], collections: [NEWS], items: (id) => (id === 'news' ? ITEMS : []),
    products: [{ id: 'p1', title: 'Kit', summary: 'A kit', priceCents: 1250, category: 'Kits', accent: '' }],
    formatPrice: (c) => `€${(c / 100).toFixed(2)}`,
    form: { action: (id) => `/s/acme/_form/${id}`, token: 'tok' }, preview: false,
    ...overrides,
  };
}

export function page(sections: CmsPage['sections']): CmsPage {
  return { id: 'home', slug: 'home', title: { en: 'Home' }, nav: 'none', order: 0, seo: { title: {}, description: {} }, sections, updatedAt: NOW };
}
