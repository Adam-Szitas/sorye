import { cachedManifest, cachedRevision } from './cache';
import { mediaInfo, readSiteItems, readSiteManifest, readSitePage, RevisionChangedError, type SiteManifest } from './public-client';
import type { SiteSource } from './render';

/** Live manifest for a slug, cached until the next publish. */
export function loadManifest(slug: string): Promise<SiteManifest | null> {
  return cachedManifest(slug, () => readSiteManifest(slug));
}

/** A renderer source for the live revision; pages and items are cached per revision. */
export function publishedSource(manifest: SiteManifest): SiteSource {
  const { slug, revisionId } = manifest;
  return {
    slug,
    settings: manifest.settings,
    pages: manifest.pages,
    collections: manifest.collections,
    products: manifest.products,
    media: mediaInfo(slug, manifest.media),
    loadPage: (pageId) => cachedRevision(slug, revisionId, `p:${pageId}`, () => readSitePage(slug, revisionId, pageId)),
    loadItems: (collection) => cachedRevision(slug, revisionId, `i:${collection.id}`, () => readSiteItems(slug, revisionId, collection)),
  };
}

/** Runs `render` against the live revision, re-reading once if a publish raced it. */
export async function withPublishedSource<T>(slug: string, render: (source: SiteSource, manifest: SiteManifest) => Promise<T>): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const manifest = attempt === 0 ? await loadManifest(slug) : await readSiteManifest(slug);
    if (!manifest) return null;
    try {
      return await render(publishedSource(manifest), manifest);
    } catch (error) {
      if (!(error instanceof RevisionChangedError) || attempt === 1) throw error;
    }
  }
  return null;
}
