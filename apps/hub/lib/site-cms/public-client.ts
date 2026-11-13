import { z } from 'zod';
import {
  validateCollection, validateItem, validatePage, validateSettings,
  type CmsPage, type MediaInfo, type PublicProduct, type SiteCollection, type SiteCollectionItem, type SiteSettings,
} from '@sorye/site-sdk';
import { PUBLIC_SITE_CONTEXT, RodrigoResponseError, RodrigoUnavailableError } from '@/lib/rodrigo/service-client';
import { readJson, signedFetch } from '@/lib/rodrigo/transport';

/**
 * Anonymous reads of a site's live published revision. Uses Rodrigo's reserved
 * public-site grant: the slug selects the site, never a workspace. Every document is
 * re-validated with the SDK before it reaches the renderer.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;

export interface PublicMedia { id: string; name: string; contentType: string; sizeBytes: number; width: number; height: number }

export interface SiteManifest {
  slug: string;
  revisionId: string;
  publishedAt: string;
  settings: SiteSettings;
  pages: Array<Pick<CmsPage, 'id' | 'slug' | 'title' | 'nav' | 'order' | 'seo'>>;
  collections: SiteCollection[];
  media: PublicMedia[];
  products: PublicProduct[];
}

const manifestSchema = z.object({
  slug: z.string().regex(SLUG).max(64), revisionId: z.string().regex(ID), publishedAt: z.string().max(64),
  settings: z.record(z.unknown()), pages: z.array(z.record(z.unknown())).max(50), collections: z.array(z.record(z.unknown())).max(20),
  media: z.array(z.object({ id: z.string().regex(ID), name: z.string().max(255), contentType: z.string().max(80), sizeBytes: z.number().int(), width: z.number().int(), height: z.number().int(), alt: z.unknown() })).max(500),
  products: z.array(z.object({ id: z.string().max(160), title: z.string().max(120), summary: z.string().max(240), priceCents: z.number().int().min(0), category: z.string().max(40), accent: z.string().max(32) }).strict()).max(100),
}).strict();

const READ = { scope: 'actions:read', appScopes: ['site'], actionScopes: ['read:site.cmsPage'] };

async function getJson<T>(path: string, schema: z.ZodType<T>, limit: number): Promise<T | null> {
  const response = await signedFetch({ context: PUBLIC_SITE_CONTEXT, method: 'GET', path, ...READ, timeoutMs: 3000 });
  try {
    return await readJson(response, schema, limit);
  } catch (error) {
    if (error instanceof RodrigoResponseError && error.status === 404) return null;
    throw error;
  }
}

/** `null` when the slug has no published CMS revision. Invalid stored data fails closed. */
export async function readSiteManifest(slug: string): Promise<SiteManifest | null> {
  if (!SLUG.test(slug) || slug.length > 64) return null;
  const raw = await getJson(`/v2/public/site-cms/${slug}`, manifestSchema, 2 * 1024 * 1024);
  if (!raw) return null;
  if (validateSettings(raw.settings).length > 0) throw new RodrigoUnavailableError();
  const collections = raw.collections.filter((c) => validateCollection(c).length === 0) as unknown as SiteCollection[];
  const pages = raw.pages.filter((p) => typeof p.id === 'string' && ID.test(p.id) && typeof p.slug === 'string' && SLUG.test(p.slug)) as unknown as SiteManifest['pages'];
  return { slug: raw.slug, revisionId: raw.revisionId, publishedAt: raw.publishedAt, settings: raw.settings as unknown as SiteSettings, pages, collections, media: raw.media, products: raw.products };
}

export class RevisionChangedError extends Error {
  constructor() { super('The live revision changed.'); }
}

async function revisionRead<T>(slug: string, revision: string, kind: 'pages' | 'items', id: string, schema: z.ZodType<T>, limit: number): Promise<T | null> {
  if (!SLUG.test(slug) || !ID.test(revision) || !ID.test(id)) return null;
  try {
    return await getJson(`/v2/public/site-cms/${slug}/revisions/${revision}/${kind}/${id}`, schema, limit);
  } catch (error) {
    if (error instanceof RodrigoResponseError && error.status === 409) throw new RevisionChangedError();
    throw error;
  }
}

/** A page of the live revision; sections are validated again at render time. */
export async function readSitePage(slug: string, revision: string, pageId: string): Promise<CmsPage | null> {
  const page = await revisionRead(slug, revision, 'pages', pageId, z.record(z.unknown()), 1024 * 1024);
  if (!page) return null;
  // Section-level problems skip the section in the renderer; page-level problems fail closed.
  const fatal = validatePage(page).filter((i) => !i.path.startsWith('page.sections['));
  if (fatal.length > 0) throw new RodrigoUnavailableError();
  return page as unknown as CmsPage;
}

export async function readSiteItems(slug: string, revision: string, collection: SiteCollection): Promise<SiteCollectionItem[]> {
  const result = await revisionRead(slug, revision, 'items', collection.id, z.object({ items: z.array(z.record(z.unknown())).max(500) }).strict(), 8 * 1024 * 1024);
  return (result?.items ?? []).filter((item) => validateItem(item, collection).length === 0) as unknown as SiteCollectionItem[];
}

/** Streams a media file of the live revision. The caller pipes or cancels the body. */
export async function openSiteMedia(slug: string, mediaId: string, headers: { range?: string | null; ifNoneMatch?: string | null }): Promise<Response | null> {
  if (!SLUG.test(slug) || !ID.test(mediaId)) return null;
  const forwarded: Record<string, string> = {};
  if (headers.range && /^bytes=\d*-\d*$/.test(headers.range)) forwarded.Range = headers.range;
  if (headers.ifNoneMatch && /^"?[0-9a-f]{64}"?$/.test(headers.ifNoneMatch)) forwarded['If-None-Match'] = headers.ifNoneMatch;
  const response = await signedFetch({
    context: PUBLIC_SITE_CONTEXT, method: 'GET', path: `/v2/public/site-cms/${slug}/media/${mediaId}`,
    scope: 'actions:read', appScopes: ['site'], actionScopes: ['read:site.media'], headers: forwarded, streamResponse: true, timeoutMs: 10_000,
  });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok && response.status !== 304 && response.status !== 206) { await response.body?.cancel(); throw new RodrigoUnavailableError(); }
  return response;
}

export type SubmitOutcome = 'accepted' | 'duplicate' | 'not_found' | 'invalid' | 'conflict';

/** Stores one anonymous submission. Never retried here: a lost response may still mean stored. */
export async function submitSiteForm(slug: string, pageId: string, sectionId: string, input: { submissionId: string; locale: string; answers: Record<string, unknown> }): Promise<SubmitOutcome> {
  if (!SLUG.test(slug) || !ID.test(pageId) || !ID.test(sectionId)) return 'not_found';
  const body = JSON.stringify(input);
  const response = await signedFetch({
    context: PUBLIC_SITE_CONTEXT, method: 'POST', path: `/v2/public/site-cms/${slug}/forms/${pageId}/${sectionId}/submissions`,
    scope: 'actions:write', appScopes: ['site'], actionScopes: ['action:site.submission.create'], body, timeoutMs: 5000,
  });
  try {
    const result = await readJson(response, z.object({ status: z.enum(['accepted', 'duplicate']), submissionId: z.string().uuid() }).strict());
    return result.status;
  } catch (error) {
    if (error instanceof RodrigoResponseError) {
      if (error.status === 404) return 'not_found';
      if (error.status === 422 || error.status === 400) return 'invalid';
      if (error.status === 409) return 'conflict';
    }
    throw error;
  }
}

export function mediaInfo(slug: string, media: PublicMedia[]): (id: string) => MediaInfo | undefined {
  const byId = new Map(media.map((m) => [m.id, { id: m.id, url: `/s/${slug}/media/${m.id}`, width: m.width, height: m.height, mimeType: m.contentType, name: m.name }]));
  return (id) => byId.get(id);
}
