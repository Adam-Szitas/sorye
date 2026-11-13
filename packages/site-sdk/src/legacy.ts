/**
 * Converts the earlier one-page Site (Hero, About, Links, Storefront, Contact blocks)
 * into CMS settings and a home page without losing content. The legacy record is
 * not changed; it stays live until the owner publishes from the CMS.
 */
import type { SiteLocale } from './locales';
import type { CmsPage, SiteSection, SiteSettings } from './model';
import { componentDefaults, DEFAULT_CONTACT_FIELDS } from './registry';
import { codePoints, isSafeLink, isSectionId } from './schema';
import { DEFAULT_THEME } from './theme';

export interface LegacyBlock {
  id: string;
  type: 'hero' | 'about' | 'links' | 'storefront' | 'contact';
  [key: string]: unknown;
}

export interface LegacySite {
  slug: string;
  displayName: string;
  blocks: LegacyBlock[];
}

export type MigrationNote =
  | { kind: 'externalImage'; sectionId: string; url: string }
  | { kind: 'droppedLink'; sectionId: string; url: string }
  | { kind: 'contactLinkToForm'; sectionId: string };

export interface MigrationResult {
  settings: SiteSettings;
  page: CmsPage;
  notes: MigrationNote[];
}

const clip = (value: unknown, max: number) => {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
  return codePoints(text) > max ? [...text].slice(0, max).join('') : text;
};

function sectionId(raw: unknown, used: Set<string>, fallback: string): string {
  let id = typeof raw === 'string' && isSectionId(raw) ? raw : fallback;
  let n = 2;
  while (used.has(id)) id = `${fallback}-${n++}`;
  used.add(id);
  return id;
}

export function migrateLegacySite(legacy: LegacySite, locale: SiteLocale, now = new Date().toISOString()): MigrationResult {
  const notes: MigrationNote[] = [];
  const used = new Set<string>(['header', 'footer']);
  const lt = (value: unknown, max: number) => {
    const text = clip(value, max);
    return text ? { [locale]: text } : {};
  };
  const hasContactForm = legacy.blocks.some((b) => b.type === 'contact' && (b.href === '/contact' || !b.href));
  const mapHref = (href: unknown, id: string): string => {
    const value = typeof href === 'string' ? href.trim() : '';
    if (!value) return '';
    if (value === '/contact') return hasContactForm ? '#contact' : '';
    if (isSafeLink(value)) return value;
    notes.push({ kind: 'droppedLink', sectionId: id, url: value.slice(0, 500) });
    return '';
  };
  const sections: SiteSection[] = [{ id: 'header', type: 'header', version: 1, props: { ...componentDefaults('header'), brand: lt(legacy.displayName, 80) } }];
  for (const block of legacy.blocks) {
    switch (block.type) {
      case 'hero': {
        const id = sectionId(block.id, used, 'hero');
        if (typeof block.imageUrl === 'string' && block.imageUrl) notes.push({ kind: 'externalImage', sectionId: id, url: block.imageUrl.slice(0, 500) });
        sections.push({ id, type: 'hero', version: 1, props: { ...componentDefaults('hero'), heading: lt(block.heading || legacy.displayName, 120), subheading: lt(block.offer, 300), ctaLabel: lt(block.ctaLabel, 40), ctaHref: mapHref(block.ctaHref, id) } });
        break;
      }
      case 'about': {
        const id = sectionId(block.id, used, 'about');
        sections.push({ id, type: 'richText', version: 1, props: { heading: {}, body: lt(block.text, 20000) } });
        break;
      }
      case 'links': {
        const id = sectionId(block.id, used, 'links');
        const links = (Array.isArray(block.links) ? block.links : [])
          .map((l: { label?: unknown; url?: unknown }) => ({ label: lt(l?.label, 60), href: mapHref(l?.url, id) }))
          .filter((l) => l.href && Object.keys(l.label).length > 0)
          .slice(0, 12);
        sections.push({ id, type: 'linkList', version: 1, props: { heading: lt(block.heading, 120), links } });
        break;
      }
      case 'storefront': {
        const id = sectionId(block.id, used, 'shop');
        sections.push({ id, type: 'productShowcase', version: 1, props: { heading: lt(block.heading, 120) } });
        break;
      }
      case 'contact': {
        const href = typeof block.href === 'string' ? block.href : '/contact';
        if (href.startsWith('mailto:') && isSafeLink(href)) {
          const id = sectionId(block.id, used, 'contact-cta');
          sections.push({ id, type: 'cta', version: 1, props: { heading: lt(block.heading || block.ctaLabel || 'Contact', 120), body: {}, ctaLabel: lt(block.ctaLabel, 40), ctaHref: href, tone: 'subtle' } });
        } else {
          const id = used.has('contact') ? sectionId(block.id, used, 'contact') : sectionId('contact', used, 'contact');
          notes.push({ kind: 'contactLinkToForm', sectionId: id });
          sections.push({ id, type: 'contactForm', version: 1, props: { ...componentDefaults('contactForm'), heading: lt(block.heading, 120), submitLabel: lt(block.ctaLabel, 40), fields: DEFAULT_CONTACT_FIELDS.map((f) => ({ ...f })) } });
        }
        break;
      }
    }
  }
  sections.push({ id: 'footer', type: 'footer', version: 1, props: { ...componentDefaults('footer'), copyright: lt(`© ${legacy.displayName}`, 120) } });
  const name = clip(legacy.displayName, 120) || 'Site';
  const page: CmsPage = { id: 'home', slug: 'home', title: { [locale]: name }, nav: 'none', order: 0, seo: { title: {}, description: {} }, sections, updatedAt: now };
  const settings: SiteSettings = {
    id: 'site', slug: legacy.slug, name, theme: { ...DEFAULT_THEME, overrides: {} }, logo: null, favicon: null, socialImage: null,
    defaultLocale: locale, locales: [locale], seo: { title: {}, description: {} }, homePageId: 'home', updatedAt: now,
  };
  return { settings, page, notes };
}
