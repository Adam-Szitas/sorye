import {
  cloneSiteBlock,
  createSiteBlockId,
  emptySiteBlock,
  isSiteBlockType,
  isSiteSlug,
  SITE_ABOUT_MAX,
  SITE_BLOCK_ID_MAX,
  SITE_BLOCK_ID_RE,
  SITE_CTA_LABEL_MAX,
  SITE_DISPLAY_NAME_MAX,
  SITE_EMAIL_MAX,
  SITE_HEADING_MAX,
  SITE_LINK_LABEL_MAX,
  SITE_MAX_BLOCKS,
  SITE_MAX_LINKS,
  SITE_OFFER_MAX,
  SITE_SLUG_MAX_LENGTH,
  SITE_URL_MAX,
  siteSharePath,
  toSitePublicPage,
  toStorefrontPublicProduct,
  type SiteBlock,
  type SiteEditorInput,
  type SiteLink,
  type SitePage,
  type SitePublicPage,
} from '@sorye/types';
import { assertSafePublicHttpsUrl } from '@/lib/security';
import { jsonDataFile } from '@/lib/store/json-file';
import { listPublicStorefrontProducts } from '@/lib/storefront';

interface LegacySiteFields {
  offer?: string;
  about?: string;
  email?: string;
  website?: string;
  links?: SiteLink[];
  blocks?: SiteBlock[];
}

type StoredSitePage = SitePage & LegacySiteFields;

interface SiteStore {
  byWorkspaceId: Record<string, StoredSitePage>;
  bySlug: Record<string, string>;
}

const siteFile = jsonDataFile<SiteStore>('site-pages.json', () => ({
  byWorkspaceId: {},
  bySlug: {},
}));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAILTO_RE = /^mailto:([^\s@]+@[^\s@]+\.[^\s@]+)$/i;
const HASH_RE = /^#[a-z0-9-]{1,40}$/;

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function slugifyName(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return ascii || 'workspace';
}

function idSuffix(workspaceId: string, length = 8): string {
  const compact = workspaceId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const suffix = compact.slice(-length) || 'site';
  return suffix.slice(0, length);
}

export function deriveSiteSlug(workspaceName: string, workspaceId: string): string {
  const joined = `${slugifyName(workspaceName)}-${idSuffix(workspaceId)}`;
  const trimmed = joined.slice(0, SITE_SLUG_MAX_LENGTH).replace(/-+$/g, '');
  return isSiteSlug(trimmed) ? trimmed : `workspace-${idSuffix(workspaceId)}`;
}

function allocateSlug(
  store: SiteStore,
  workspaceId: string,
  workspaceName: string,
): string {
  let candidate = deriveSiteSlug(workspaceName, workspaceId);
  let extra = 10;
  while (store.bySlug[candidate] && store.bySlug[candidate] !== workspaceId) {
    const next = `${slugifyName(workspaceName)}-${idSuffix(workspaceId, extra)}`;
    candidate = next.slice(0, SITE_SLUG_MAX_LENGTH).replace(/-+$/g, '');
    if (!isSiteSlug(candidate)) {
      candidate = `workspace-${idSuffix(workspaceId, extra)}`;
    }
    extra += 2;
    if (extra > 24) {
      throw new Error('Could not allocate a public slug');
    }
  }
  return candidate;
}

function clonePage(page: SitePage): SitePage {
  return {
    workspaceId: page.workspaceId,
    slug: page.slug,
    published: page.published,
    displayName: page.displayName,
    blocks: page.blocks.map(cloneSiteBlock),
    updatedAt: page.updatedAt,
  };
}

function rejectUnsafeScheme(raw: string): void {
  const lower = raw.trim().toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:')
  ) {
    throw new Error('URL is invalid');
  }
}

/** CTA / contact href: https, /contact, mailto, or a same-page hash. */
export function assertSafeSiteHref(raw: string): string {
  const value = clip(raw, SITE_URL_MAX);
  if (!value) return '';
  rejectUnsafeScheme(value);

  if (value === '/contact') return '/contact';
  if (HASH_RE.test(value)) return value;

  const mailto = value.match(MAILTO_RE);
  if (mailto) {
    const email = mailto[1]?.toLowerCase() ?? '';
    if (!EMAIL_RE.test(email)) {
      throw new Error('Email is invalid');
    }
    return `mailto:${email}`;
  }

  return assertSafePublicHttpsUrl(value);
}

function parseOptionalHttps(raw: string | undefined): string | undefined {
  const value = clip(raw ?? '', SITE_URL_MAX);
  if (!value) return undefined;
  rejectUnsafeScheme(value);
  try {
    return assertSafePublicHttpsUrl(value);
  } catch {
    return undefined;
  }
}

function parseLinks(raw: SiteLink[] | undefined): SiteLink[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('Links must be a list');
  }
  if (raw.length > SITE_MAX_LINKS) {
    throw new Error(`At most ${SITE_MAX_LINKS} links`);
  }

  const links: SiteLink[] = [];
  for (const item of raw) {
    const label = clip(item?.label ?? '', SITE_LINK_LABEL_MAX);
    const urlRaw = clip(item?.url ?? '', SITE_URL_MAX);
    if (!label && !urlRaw) continue;
    if (!label) throw new Error('Each link needs a label');
    if (!urlRaw) throw new Error('Each link needs an https URL');
    rejectUnsafeScheme(urlRaw);
    links.push({ label, url: assertSafePublicHttpsUrl(urlRaw) });
  }
  return links;
}

function parseBlockId(raw: unknown): string {
  const id = clip(typeof raw === 'string' ? raw : '', SITE_BLOCK_ID_MAX);
  if (id && SITE_BLOCK_ID_RE.test(id)) return id;
  return createSiteBlockId();
}

function parseBlock(raw: unknown): SiteBlock | null {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Each block must be an object');
  }
  const item = raw as Partial<SiteBlock> & { type?: string };
  if (!item.type || !isSiteBlockType(item.type)) {
    throw new Error('Unknown block type');
  }

  const id = parseBlockId(item.id);

  switch (item.type) {
    case 'hero': {
      const heading = clip(item.heading ?? '', SITE_HEADING_MAX);
      const offer = clip(item.offer ?? '', SITE_OFFER_MAX);
      const ctaLabel = clip(item.ctaLabel ?? '', SITE_CTA_LABEL_MAX);
      const ctaHref = item.ctaHref ? assertSafeSiteHref(item.ctaHref) : '';
      const imageUrl = parseOptionalHttps(
        'imageUrl' in item ? (item.imageUrl as string) : '',
      );
      if (!heading && !offer && !ctaLabel && !imageUrl) return null;
      return {
        id,
        type: 'hero',
        heading,
        offer,
        ctaLabel,
        ctaHref,
        ...(imageUrl ? { imageUrl } : {}),
      };
    }
    case 'about': {
      const text = clip(item.text ?? '', SITE_ABOUT_MAX);
      if (!text) return null;
      return { id, type: 'about', text };
    }
    case 'links': {
      const heading = clip(
        'heading' in item && typeof item.heading === 'string' ? item.heading : '',
        SITE_HEADING_MAX,
      );
      const links = parseLinks(item.links);
      if (!heading && links.length === 0) return null;
      return {
        id,
        type: 'links',
        ...(heading ? { heading } : {}),
        links,
      };
    }
    case 'storefront': {
      const heading = clip(
        'heading' in item && typeof item.heading === 'string' ? item.heading : '',
        SITE_HEADING_MAX,
      );
      return {
        id,
        type: 'storefront',
        ...(heading ? { heading } : {}),
      };
    }
    case 'contact': {
      const heading = clip(
        'heading' in item && typeof item.heading === 'string' ? item.heading : '',
        SITE_HEADING_MAX,
      );
      const ctaLabel = clip(item.ctaLabel ?? '', SITE_CTA_LABEL_MAX) || 'Contact';
      const hrefRaw = clip(item.href ?? '', SITE_URL_MAX) || '/contact';
      const href = assertSafeSiteHref(hrefRaw);
      if (href && href !== '/contact' && !href.startsWith('mailto:')) {
        throw new Error('Contact button must use /contact or mailto');
      }
      return {
        id,
        type: 'contact',
        ...(heading ? { heading } : {}),
        ctaLabel,
        href: href || '/contact',
      };
    }
  }
}

function parseBlocks(raw: SiteBlock[] | undefined): SiteBlock[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('Blocks must be a list');
  }
  if (raw.length > SITE_MAX_BLOCKS) {
    throw new Error(`At most ${SITE_MAX_BLOCKS} sections`);
  }
  const blocks: SiteBlock[] = [];
  for (const item of raw) {
    const parsed = parseBlock(item);
    if (parsed) blocks.push(parsed);
  }
  return blocks;
}

function migrateLegacyBlocks(stored: StoredSitePage, workspaceName: string): SiteBlock[] {
  if (Array.isArray(stored.blocks) && stored.blocks.length > 0) {
    return parseBlocks(stored.blocks);
  }

  const heading = clip(stored.displayName || workspaceName, SITE_HEADING_MAX) || 'Workspace';
  const offer = clip(stored.offer ?? '', SITE_OFFER_MAX);
  const about = clip(stored.about ?? '', SITE_ABOUT_MAX);
  const email = clip(stored.email ?? '', SITE_EMAIL_MAX);
  const website = clip(stored.website ?? '', SITE_URL_MAX);
  let websiteUrl = '';
  try {
    websiteUrl = website ? assertSafePublicHttpsUrl(website) : '';
  } catch {
    websiteUrl = '';
  }
  const links = parseLinks(stored.links);

  const blocks: SiteBlock[] = [];
  const hero = emptySiteBlock('hero');
  if (hero.type === 'hero') {
    hero.heading = heading;
    hero.offer = offer;
    if (websiteUrl) {
      hero.ctaLabel = 'Website';
      hero.ctaHref = websiteUrl;
    } else if (email && EMAIL_RE.test(email)) {
      hero.ctaLabel = 'Email';
      hero.ctaHref = `mailto:${email}`;
    } else {
      hero.ctaLabel = 'Contact';
      hero.ctaHref = '/contact';
    }
    blocks.push(hero);
  }
  if (about) {
    const aboutBlock = emptySiteBlock('about');
    if (aboutBlock.type === 'about') {
      aboutBlock.text = about;
      blocks.push(aboutBlock);
    }
  }
  if (links.length > 0 || websiteUrl) {
    const linksBlock = emptySiteBlock('links');
    if (linksBlock.type === 'links') {
      linksBlock.links = websiteUrl
        ? [{ label: 'Website', url: websiteUrl }, ...links.filter((l) => l.url !== websiteUrl)]
        : links;
      blocks.push(linksBlock);
    }
  }
  if (email && EMAIL_RE.test(email)) {
    const contact = emptySiteBlock('contact');
    if (contact.type === 'contact') {
      contact.ctaLabel = 'Email';
      contact.href = `mailto:${email}`;
      blocks.push(contact);
    }
  }
  return blocks;
}

function emptyDraft(
  workspaceId: string,
  workspaceName: string,
  slug: string,
): SitePage {
  const displayName = clip(workspaceName, SITE_DISPLAY_NAME_MAX) || 'Workspace';
  const hero = emptySiteBlock('hero');
  if (hero.type === 'hero') {
    hero.heading = displayName;
    hero.offer = '';
    hero.ctaLabel = 'Contact';
    hero.ctaHref = '/contact';
  }
  return {
    workspaceId,
    slug,
    published: false,
    displayName,
    blocks: [hero],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeStored(
  stored: StoredSitePage,
  workspaceName: string,
): SitePage {
  const displayName =
    clip(stored.displayName, SITE_DISPLAY_NAME_MAX) ||
    clip(workspaceName, SITE_DISPLAY_NAME_MAX) ||
    'Workspace';
  return {
    workspaceId: stored.workspaceId,
    slug: stored.slug,
    published: stored.published === true,
    displayName,
    blocks: migrateLegacyBlocks({ ...stored, displayName }, workspaceName),
    updatedAt: stored.updatedAt,
  };
}

export async function getSiteForWorkspace(
  workspaceId: string,
  workspaceName: string,
): Promise<SitePage> {
  const snapshot = await siteFile.read();
  const existing = snapshot.byWorkspaceId[workspaceId];
  if (existing) return clonePage(normalizeStored(existing, workspaceName));
  return emptyDraft(workspaceId, workspaceName, deriveSiteSlug(workspaceName, workspaceId));
}

export async function saveSiteForWorkspace(
  workspaceId: string,
  workspaceName: string,
  input: SiteEditorInput,
): Promise<{ page: SitePage; justPublished: boolean }> {
  const displayName = clip(input.displayName ?? '', SITE_DISPLAY_NAME_MAX);
  if (!displayName) {
    throw new Error('Display name is required');
  }

  const blocks = parseBlocks(input.blocks);
  const published = input.published === true;

  return siteFile.update((store) => {
    const previous = store.byWorkspaceId[workspaceId];
    const slug = previous?.slug ?? allocateSlug(store, workspaceId, workspaceName);

    const page: SitePage = {
      workspaceId,
      slug,
      published,
      displayName,
      blocks,
      updatedAt: new Date().toISOString(),
    };

    store.byWorkspaceId[workspaceId] = page;
    store.bySlug[slug] = workspaceId;

    return {
      page: clonePage(page),
      justPublished: published && previous?.published !== true,
    };
  });
}

export async function getPublishedSiteBySlug(
  slug: string,
): Promise<SitePublicPage | null> {
  if (!isSiteSlug(slug)) return null;

  const snapshot = await siteFile.read();
  const workspaceId = snapshot.bySlug[slug];
  if (!workspaceId) return null;

  const stored = snapshot.byWorkspaceId[workspaceId];
  if (!stored || stored.slug !== slug || !stored.published) return null;
  if (stored.workspaceId !== workspaceId) return null;

  const page = normalizeStored(stored, stored.displayName || 'Workspace');
  if (!page.published) return null;

  const needsProducts = page.blocks.some((block) => block.type === 'storefront');
  const products = needsProducts
    ? (await listPublicStorefrontProducts(workspaceId)).map(toStorefrontPublicProduct)
    : [];

  return toSitePublicPage(page, products);
}

export { siteSharePath };
