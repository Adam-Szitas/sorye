import { onRodrigoChange, onRodrigoChangeReset, rodrigoChangesHealthy } from '@/lib/rodrigo/changes';

/**
 * Published-site read cache. Safe to lose; never a write path.
 *
 * - Manifests (slug → live revision) are dropped on any Rodrigo change to a Site
 *   publish or settings resource, or to a Storefront product (product cards are live).
 *   Public reads do not learn the workspace id, so invalidation is not per workspace;
 *   publishes are rare, so a global drop is cheap.
 * - Pages and items are keyed by revision id. A revision never changes, so these
 *   entries need no invalidation; LRU and a TTL bound memory.
 * - Bypassed while the change stream is unhealthy, like `read-cache.ts`.
 */
interface Entry { value: unknown; expires: number; bytes: number }
interface State { entries: Map<string, Entry>; bytes: number; generation: number; wired: boolean; hits: number; misses: number }

const MAX_ENTRIES = 2000;
const MAX_BYTES = 32 * 1024 * 1024;
const MANIFEST_TTL_MS = 60_000;
const REVISION_TTL_MS = 10 * 60_000;

const key = Symbol.for('sorye.site.publicCache');
const g = globalThis as unknown as Record<symbol, State | undefined>;

function state(): State {
  g[key] ??= { entries: new Map(), bytes: 0, generation: 0, wired: false, hits: 0, misses: 0 };
  const s = g[key]!;
  if (!s.wired) {
    s.wired = true;
    onRodrigoChange((change) => {
      const site = change.appId === 'site' && (change.resourceType === 'publish' || change.resourceType === 'settings');
      const products = change.appId === 'storefront' && change.resourceType === 'product';
      if (site || products) dropManifests(s);
    });
    onRodrigoChangeReset(() => clearSiteCache());
  }
  return s;
}

function dropManifests(s: State) {
  s.generation += 1;
  for (const [k, entry] of s.entries) {
    if (k.startsWith('m\u0000')) { s.bytes -= entry.bytes; s.entries.delete(k); }
  }
}

export function clearSiteCache(): void {
  const s = state();
  s.entries.clear(); s.bytes = 0; s.generation += 1;
}

/** Drops cached manifests now (same replica), e.g. right after this replica published. */
export function invalidateSiteManifests(): void {
  dropManifests(state());
}

export function siteCacheStats() {
  const s = state();
  return { entries: s.entries.size, bytes: s.bytes, hits: s.hits, misses: s.misses };
}

async function cached<T>(fullKey: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const s = state();
  if (!rodrigoChangesHealthy()) return load();
  const hit = s.entries.get(fullKey);
  if (hit && hit.expires > Date.now()) {
    s.hits += 1;
    s.entries.delete(fullKey); s.entries.set(fullKey, hit);
    return hit.value as T;
  }
  s.misses += 1;
  const generation = s.generation;
  const value = await load();
  if (s.generation !== generation || !rodrigoChangesHealthy() || value === null) return value;
  const bytes = Math.min(Buffer.byteLength(JSON.stringify(value) ?? ''), MAX_BYTES);
  if (bytes > MAX_BYTES / 16) return value;
  const previous = s.entries.get(fullKey);
  if (previous) s.bytes -= previous.bytes;
  s.entries.set(fullKey, { value, expires: Date.now() + ttl, bytes });
  s.bytes += bytes;
  while (s.entries.size > MAX_ENTRIES || s.bytes > MAX_BYTES) {
    const oldest = s.entries.keys().next().value;
    if (oldest === undefined) break;
    s.bytes -= s.entries.get(oldest)!.bytes;
    s.entries.delete(oldest);
  }
  return value;
}

export function cachedManifest<T>(slug: string, load: () => Promise<T>): Promise<T> {
  return cached(`m\u0000${slug}`, MANIFEST_TTL_MS, load);
}

export function cachedRevision<T>(slug: string, revision: string, part: string, load: () => Promise<T>): Promise<T> {
  return cached(`r\u0000${slug}\u0000${revision}\u0000${part}`, REVISION_TTL_MS, load);
}
