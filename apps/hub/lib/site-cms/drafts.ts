import {
  migrateLegacySite, validateCollection, validateItem, validateMedia, validatePage, validateSettings,
  type CmsPage, type LegacyBlock, type MigrationNote, type SiteCollection, type SiteCollectionItem, type SiteLocale,
  type PublicProduct, type SiteMedia, type SitePublish, type SiteSettings, type SiteSubmission,
} from '@sorye/site-sdk';
import { getRodrigoResource, listRodrigoResources, type RodrigoContext } from '@/lib/rodrigo/service-client';
import type { SiteSource } from './render';

/**
 * The owner's draft site as stored in Rodrigo, with resource revisions for the
 * editor's optimistic writes. Documents that no longer validate are listed, not
 * dropped silently, so the editor can show and repair them.
 */
export interface Versioned<T> { value: T; revision: number }

export interface SiteDrafts {
  settings: Versioned<SiteSettings> | null;
  pages: Versioned<CmsPage>[];
  collections: Versioned<SiteCollection>[];
  items: Versioned<SiteCollectionItem>[];
  media: Versioned<SiteMedia>[];
  publishes: Versioned<SitePublish>[];
  submissions: Versioned<SiteSubmission>[];
  invalid: Array<{ resourceType: string; resourceId: string }>;
  /** Present while no CMS settings exist and an earlier one-page Site is stored. */
  legacy: { slug: string; published: boolean; notes: MigrationNote[]; settings: SiteSettings; page: CmsPage } | null;
}

/** Pages a family through Rodrigo's generic collection route, bounded. */
async function all(context: RodrigoContext, resourceType: 'cmsPage' | 'collection' | 'item' | 'media' | 'publish' | 'submission', maxPages: number) {
  const out: Array<{ resourceId: string; revision: number; resource: Record<string, unknown> }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const listed = await listRodrigoResources(context, 'site', resourceType, 100, cursor);
    out.push(...listed.items);
    if (!listed.nextCursor) break;
    cursor = listed.nextCursor;
  }
  return out;
}

export async function loadDrafts(context: RodrigoContext, options: { submissions?: boolean; legacyLocale?: SiteLocale } = {}): Promise<SiteDrafts> {
  const invalid: SiteDrafts['invalid'] = [];
  const [settingsSnap, pages, collections, items, media, publishes, submissions] = await Promise.all([
    getRodrigoResource(context, 'site', 'settings', 'site'),
    all(context, 'cmsPage', 1),
    all(context, 'collection', 1),
    // 20 collections × 500 items at most.
    all(context, 'item', 100),
    all(context, 'media', 5),
    all(context, 'publish', 5),
    options.submissions === false ? Promise.resolve([]) : all(context, 'submission', 10),
  ]);
  const keep = <T>(resourceType: string, rows: typeof pages, check: (value: Record<string, unknown>) => boolean): Versioned<T>[] =>
    rows.flatMap((row) => {
      if (check(row.resource)) return [{ value: row.resource as T, revision: row.revision }];
      invalid.push({ resourceType, resourceId: row.resourceId });
      return [];
    });
  const keptCollections = keep<SiteCollection>('collection', collections, (v) => validateCollection(v).length === 0);
  const byId = new Map(keptCollections.map((c) => [c.value.id, c.value]));
  const drafts: SiteDrafts = {
    settings: settingsSnap.resource && validateSettings(settingsSnap.resource).length === 0 ? { value: settingsSnap.resource as unknown as SiteSettings, revision: settingsSnap.revision } : null,
    pages: keep<CmsPage>('cmsPage', pages, (v) => validatePage(v).length === 0).sort((a, b) => a.value.order - b.value.order),
    collections: keptCollections,
    items: keep<SiteCollectionItem>('item', items, (v) => {
      const collection = byId.get(String(v.collectionId));
      return Boolean(collection) && validateItem(v, collection!).length === 0;
    }).sort((a, b) => a.value.order - b.value.order),
    media: keep<SiteMedia>('media', media, (v) => validateMedia(v).length === 0),
    publishes: publishes.map((row) => ({ value: row.resource as unknown as SitePublish, revision: row.revision }))
      .sort((a, b) => b.value.createdAt.localeCompare(a.value.createdAt)),
    submissions: submissions.map((row) => ({ value: row.resource as unknown as SiteSubmission, revision: row.revision }))
      .sort((a, b) => b.value.submittedAt.localeCompare(a.value.submittedAt)),
    invalid,
    legacy: null,
  };
  if (settingsSnap.resource && !drafts.settings) invalid.push({ resourceType: 'settings', resourceId: 'site' });
  if (!settingsSnap.resource) {
    const legacy = await getRodrigoResource(context, 'site', 'page', context.workspaceId);
    const resource = legacy.resource as { slug?: string; title?: string; published?: boolean; blocks?: Array<{ id: string; kind: string; content: Record<string, unknown> }> } | null;
    if (resource && typeof resource.slug === 'string' && Array.isArray(resource.blocks)) {
      const blocks = resource.blocks.map((b) => ({ id: b.id, type: b.kind === 'shop' ? 'storefront' : b.kind, ...b.content }) as LegacyBlock);
      const migrated = migrateLegacySite({ slug: resource.slug, displayName: resource.title ?? 'Site', blocks }, options.legacyLocale ?? 'en');
      drafts.legacy = { slug: resource.slug, published: resource.published === true, notes: migrated.notes, settings: migrated.settings, page: migrated.page };
    }
  }
  return drafts;
}

/** Renderer source over the owner's drafts, for the CMS preview. Media is served to members only. */
export async function draftSource(context: RodrigoContext, drafts: SiteDrafts): Promise<SiteSource | null> {
  if (!drafts.settings) return null;
  const media = new Map(drafts.media.map(({ value: m }) => [m.id, { id: m.id, url: `/api/site/media/${m.id}`, width: m.width, height: m.height, mimeType: m.contentType, name: m.name }]));
  const shows = drafts.pages.some((p) => p.value.sections.some((s) => s.type === 'productShowcase'));
  const products = shows ? await previewProducts(context) : [];
  return {
    slug: drafts.settings.value.slug,
    settings: drafts.settings.value,
    pages: drafts.pages.map((p) => p.value),
    collections: drafts.collections.map((c) => c.value),
    products,
    media: (id) => media.get(id),
    loadPage: async (id) => drafts.pages.find((p) => p.value.id === id)?.value ?? null,
    // The preview shows drafts too, so owners can check an item before publishing it.
    loadItems: async (collection) => drafts.items.filter((i) => i.value.collectionId === collection.id).map((i) => ({ ...i.value, status: 'published' as const })),
  };
}

/** Active Storefront products as public cards, like Rodrigo's public projection. */
async function previewProducts(context: RodrigoContext): Promise<PublicProduct[]> {
  try {
    const listed = await listRodrigoResources(context, 'storefront', 'product', 100);
    return listed.items.flatMap(({ resource: r }) => {
      if (r.active !== true || typeof r.id !== 'string' || typeof r.name !== 'string' || !Number.isSafeInteger(r.priceMinor)) return [];
      return [{
        id: r.id, title: r.name.slice(0, 120), summary: String(r.summary ?? r.description ?? '').slice(0, 240),
        priceCents: r.priceMinor as number, category: String(r.category ?? '').slice(0, 40), accent: String(r.accent ?? '').slice(0, 32),
      }];
    });
  } catch {
    return [];
  }
}
