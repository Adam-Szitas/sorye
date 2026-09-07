/** Workspace public site — section/block builder published at `/s/[slug]`. */

export const SITE_SLUG_MAX_LENGTH = 64;
export const SITE_DISPLAY_NAME_MAX = 80;
export const SITE_OFFER_MAX = 160;
export const SITE_ABOUT_MAX = 2000;
export const SITE_EMAIL_MAX = 120;
export const SITE_URL_MAX = 500;
export const SITE_LINK_LABEL_MAX = 40;
export const SITE_MAX_LINKS = 8;
export const SITE_MAX_BLOCKS = 12;
export const SITE_HEADING_MAX = 80;
export const SITE_CTA_LABEL_MAX = 40;
export const SITE_BLOCK_ID_MAX = 40;

export const SITE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SITE_BLOCK_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;

export const SITE_BLOCK_TYPES = [
  'hero',
  'about',
  'links',
  'storefront',
  'contact',
] as const;

export type SiteBlockType = (typeof SITE_BLOCK_TYPES)[number];

export const SITE_BLOCK_LABELS: Record<SiteBlockType, string> = {
  hero: 'Hero',
  about: 'About',
  links: 'Links',
  storefront: 'Storefront',
  contact: 'Contact',
};

export interface SiteLink {
  label: string;
  url: string;
}

export interface SiteHeroBlock {
  id: string;
  type: 'hero';
  heading: string;
  offer: string;
  ctaLabel: string;
  ctaHref: string;
  imageUrl?: string;
}

export interface SiteAboutBlock {
  id: string;
  type: 'about';
  text: string;
}

export interface SiteLinksBlock {
  id: string;
  type: 'links';
  heading?: string;
  links: SiteLink[];
}

export interface SiteStorefrontBlock {
  id: string;
  type: 'storefront';
  heading?: string;
}

export interface SiteContactBlock {
  id: string;
  type: 'contact';
  heading?: string;
  ctaLabel: string;
  href: string;
}

export type SiteBlock =
  | SiteHeroBlock
  | SiteAboutBlock
  | SiteLinksBlock
  | SiteStorefrontBlock
  | SiteContactBlock;

/** Full record for the signed-in editor. Never send this shape to `/s/[slug]`. */
export interface SitePage {
  workspaceId: string;
  slug: string;
  published: boolean;
  displayName: string;
  blocks: SiteBlock[];
  updatedAt: string;
}

/** Names and prices only — never orders, members, or workspace ids. */
export interface SitePublicProduct {
  id: string;
  title: string;
  summary: string;
  priceCents: number;
  category: string;
  accent: string;
}

/** Published fields only — no workspace id, members, or unpublished draft. */
export interface SitePublicPage {
  slug: string;
  displayName: string;
  blocks: SiteBlock[];
  products: SitePublicProduct[];
}

export interface SiteEditorInput {
  published?: boolean;
  displayName?: string;
  blocks?: SiteBlock[];
}

export type SiteTemplateId = 'company' | 'shop' | 'hiring';

export interface SiteTemplate {
  id: SiteTemplateId;
  name: string;
  summary: string;
}

export const SITE_TEMPLATES: readonly SiteTemplate[] = [
  {
    id: 'company',
    name: 'Company landing',
    summary: 'Hero, about, links, and a contact button.',
  },
  {
    id: 'shop',
    name: 'Shop-front',
    summary: 'Hero, this workspace’s products, about, and contact.',
  },
  {
    id: 'hiring',
    name: 'Hiring',
    summary: 'Role pitch, about, links, and apply / contact.',
  },
];

let blockSeq = 0;

export function createSiteBlockId(): string {
  blockSeq += 1;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : `${Date.now().toString(36)}${blockSeq.toString(36)}`;
  return `b${rand}`.slice(0, SITE_BLOCK_ID_MAX);
}

export function emptySiteBlock(type: SiteBlockType): SiteBlock {
  const id = createSiteBlockId();
  switch (type) {
    case 'hero':
      return {
        id,
        type: 'hero',
        heading: '',
        offer: '',
        ctaLabel: 'Get in touch',
        ctaHref: '/contact',
      };
    case 'about':
      return { id, type: 'about', text: '' };
    case 'links':
      return { id, type: 'links', heading: 'Links', links: [] };
    case 'storefront':
      return { id, type: 'storefront', heading: 'From the shop' };
    case 'contact':
      return {
        id,
        type: 'contact',
        heading: 'Contact',
        ctaLabel: 'Contact us',
        href: '/contact',
      };
  }
}

export function siteTemplateBlocks(
  templateId: SiteTemplateId,
  displayName: string,
): SiteBlock[] {
  const name = displayName.trim() || 'Our team';
  switch (templateId) {
    case 'company':
      return [
        {
          id: createSiteBlockId(),
          type: 'hero',
          heading: name,
          offer: 'A short public page for customers, partners, and the floor.',
          ctaLabel: 'Talk to us',
          ctaHref: '/contact',
        },
        {
          id: createSiteBlockId(),
          type: 'about',
          text: `${name} publishes only what you add here — a heading, a short story, and the links you choose. Nothing from Reports, Mail, or members goes on this URL.`,
        },
        {
          id: createSiteBlockId(),
          type: 'links',
          heading: 'Links',
          links: [],
        },
        {
          id: createSiteBlockId(),
          type: 'contact',
          heading: 'Get in touch',
          ctaLabel: 'Contact',
          href: '/contact',
        },
      ];
    case 'shop':
      return [
        {
          id: createSiteBlockId(),
          type: 'hero',
          heading: name,
          offer: 'Kits and packs from this workspace — prices as listed, enquiry in Hub.',
          ctaLabel: 'See the shop',
          ctaHref: '#shop',
        },
        {
          id: createSiteBlockId(),
          type: 'storefront',
          heading: 'From the shop',
        },
        {
          id: createSiteBlockId(),
          type: 'about',
          text: 'These cards are the published catalog for this workspace: names, summaries, and prices. Orders stay inside Hub.',
        },
        {
          id: createSiteBlockId(),
          type: 'contact',
          heading: 'Questions about a kit?',
          ctaLabel: 'Contact',
          href: '/contact',
        },
      ];
    case 'hiring':
      return [
        {
          id: createSiteBlockId(),
          type: 'hero',
          heading: `Work with ${name}`,
          offer: 'We are hiring people who like clear tools and a short public page.',
          ctaLabel: 'Apply',
          ctaHref: '/contact',
        },
        {
          id: createSiteBlockId(),
          type: 'about',
          text: `${name} is looking for operators and builders. Say who you are, what you ship, and when you can start. This page is the public pitch — the rest of the workspace stays private.`,
        },
        {
          id: createSiteBlockId(),
          type: 'links',
          heading: 'Learn more',
          links: [],
        },
        {
          id: createSiteBlockId(),
          type: 'contact',
          heading: 'Apply',
          ctaLabel: 'Send a note',
          href: '/contact',
        },
      ];
  }
}

export function isSiteSlug(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= SITE_SLUG_MAX_LENGTH &&
    SITE_SLUG_RE.test(value)
  );
}

export function isSiteBlockType(value: string): value is SiteBlockType {
  return (SITE_BLOCK_TYPES as readonly string[]).includes(value);
}

export function cloneSiteBlock(block: SiteBlock): SiteBlock {
  if (block.type === 'links') {
    return {
      ...block,
      links: block.links.map((link) => ({ ...link })),
    };
  }
  return { ...block };
}

export function toSitePublicPage(
  page: SitePage,
  products: SitePublicProduct[] = [],
): SitePublicPage {
  const hasStorefront = page.blocks.some((block) => block.type === 'storefront');
  return {
    slug: page.slug,
    displayName: page.displayName,
    blocks: page.blocks.map(cloneSiteBlock),
    products: hasStorefront ? products.map((product) => ({ ...product })) : [],
  };
}

export function siteSharePath(slug: string): string {
  return `/s/${slug}`;
}

export function toStorefrontPublicProduct(product: {
  id: string;
  title: string;
  summary: string;
  priceCents: number;
  category: string;
  accent: string;
}): SitePublicProduct {
  return {
    id: product.id,
    title: product.title,
    summary: product.summary,
    priceCents: product.priceCents,
    category: product.category,
    accent: product.accent,
  };
}
