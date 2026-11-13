/** Site document model shared by the CMS, Hub's public renderer and Rodrigo's contract. */
import type { LText, SiteLocale } from './locales';
import type { MediaRef } from './schema';
import type { SiteTheme } from './theme';

export const SITE_MODEL_LIMITS = {
  pages: 50,
  sectionsPerPage: 40,
  collections: 20,
  collectionFields: 30,
  itemsPerCollection: 500,
  slugMax: 64,
  nameMax: 120,
  seoTitleMax: 120,
  seoDescriptionMax: 300,
  itemTextMax: 2000,
  itemRichTextMax: 20000,
} as const;

export const PAGE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Page and collection slugs that would shadow renderer routes or locale prefixes. */
export const RESERVED_PAGE_SLUGS = ['sitemap', 'sitemap-xml', 'robots', '_form', 'media', 'en', 'de', 'sk', 'hu', 'es', 'esp'] as const;

export interface SiteSection {
  id: string;
  type: string;
  version: number;
  props: Record<string, unknown>;
}

export type NavPlacement = 'header' | 'footer' | 'both' | 'none';

export interface SiteSeo {
  title: LText;
  description: LText;
}

export interface CmsPage {
  id: string;
  slug: string;
  title: LText;
  nav: NavPlacement;
  order: number;
  seo: SiteSeo;
  sections: SiteSection[];
  updatedAt: string;
}

export interface SiteSettings {
  id: 'site';
  slug: string;
  name: string;
  theme: SiteTheme;
  logo: MediaRef | null;
  favicon: MediaRef | null;
  socialImage: MediaRef | null;
  defaultLocale: SiteLocale;
  locales: SiteLocale[];
  seo: SiteSeo;
  homePageId: string;
  updatedAt: string;
}

export const COLLECTION_FIELD_KINDS = ['text', 'richtext', 'number', 'date', 'boolean', 'link', 'media', 'select'] as const;
export type CollectionFieldKind = (typeof COLLECTION_FIELD_KINDS)[number];

export interface CollectionField {
  key: string;
  label: LText;
  kind: CollectionFieldKind;
  required: boolean;
  options: string[];
}

export type CollectionSort = 'manual' | 'dateDesc' | 'titleAsc';

export interface SiteCollection {
  id: string;
  slug: string;
  name: LText;
  fields: CollectionField[];
  titleField: string;
  sort: CollectionSort;
  sortField: string;
  detailPages: boolean;
  updatedAt: string;
}

export type CollectionValue = LText | number | boolean | string | MediaRef | null;

export interface SiteCollectionItem {
  id: string;
  collectionId: string;
  slug: string;
  status: 'draft' | 'published';
  order: number;
  values: Record<string, CollectionValue>;
  updatedAt: string;
}

export interface PublicProduct {
  id: string;
  title: string;
  summary: string;
  priceCents: number;
  category: string;
  accent: string;
}

/** Media metadata the renderer needs. Bytes are served by Hub from Rodrigo storage. */
export interface MediaInfo {
  id: string;
  url: string;
  width: number;
  height: number;
  mimeType: string;
  name: string;
}
