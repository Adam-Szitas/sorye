import { onRodrigoChange, onRodrigoChangeReset, rodrigoChangesHealthy } from './changes';

/**
 * Short-lived, bounded read cache in front of Rodrigo. Safe to lose at any time: it is
 * never a write path and never a source of truth.
 *
 * - Entries are keyed by workspace, app and resource type, and dropped by any Rodrigo
 *   change to that type in that workspace (collections included).
 * - It is bypassed whenever the change stream is not healthy, so a missed invalidation
 *   cannot serve stale data for longer than the stream's own reconnect window.
 * - A read that started before an invalidation is not stored (generation check), which
 *   closes the read/invalidate race.
 * - TTL caps staleness even if an invalidation is lost.
 */
interface Entry { value: unknown; expires: number; group: string; bytes: number }

const MAX_ENTRIES = 5000;
const MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_TTL_MS = 15_000;

interface CacheState {
  entries: Map<string, Entry>; generations: Map<string, number>; bytes: number; wired: boolean;
  hits: number; misses: number; bypasses: number;
}
const key = Symbol.for('sorye.rodrigo.readCache');
const g = globalThis as unknown as Record<symbol, CacheState | undefined>;
function cache(): CacheState {
  g[key] ??= { entries: new Map(), generations: new Map(), bytes: 0, wired: false, hits: 0, misses: 0, bypasses: 0 };
  const c = g[key]!;
  if (!c.wired) {
    c.wired = true;
    onRodrigoChange((change) => invalidateGroup(groupKey(change.workspaceId, change.appId, change.resourceType)));
    onRodrigoChangeReset(() => clearReadCache());
  }
  return c;
}

function groupKey(workspaceId: string, appId: string, resourceType: string) {
  return `${workspaceId}\u0000${appId}\u0000${resourceType}`;
}

export function invalidateGroup(group: string): void {
  const c = cache();
  c.generations.set(group, (c.generations.get(group) ?? 0) + 1);
  if (c.generations.size > 50_000) c.generations.clear();
  for (const [k, entry] of c.entries) {
    if (entry.group === group) { c.entries.delete(k); c.bytes -= entry.bytes; }
  }
}

export function clearReadCache(): void {
  const c = cache();
  c.entries.clear();
  c.bytes = 0;
  // Bump every known generation so in-flight reads are not stored after a reset.
  for (const [group, generation] of c.generations) c.generations.set(group, generation + 1);
}

export function readCacheStats() {
  const c = cache();
  return { entries: c.entries.size, bytes: c.bytes, hits: c.hits, misses: c.misses, bypasses: c.bypasses };
}

/**
 * Returns a cached value or loads it. `scope` identifies the Rodrigo resource family whose
 * changes invalidate it; `key` distinguishes reads within it (e.g. a page cursor).
 */
export async function cachedRead<T>(
  scope: { workspaceId: string; appId: string; resourceType: string },
  key: string,
  load: () => Promise<T>,
  options: { ttlMs?: number; sizeHint?: number } = {},
): Promise<T> {
  const c = cache();
  if (!rodrigoChangesHealthy()) { c.bypasses += 1; return load(); }
  const group = groupKey(scope.workspaceId, scope.appId, scope.resourceType);
  const fullKey = `${group}\u0000${key}`;
  const hit = c.entries.get(fullKey);
  if (hit && hit.expires > Date.now()) {
    c.hits += 1;
    // LRU: move to the end.
    c.entries.delete(fullKey);
    c.entries.set(fullKey, hit);
    return hit.value as T;
  }
  c.misses += 1;
  const generation = c.generations.get(group) ?? 0;
  const value = await load();
  if ((c.generations.get(group) ?? 0) !== generation || !rodrigoChangesHealthy()) return value;
  const bytes = options.sizeHint ?? estimate(value);
  if (bytes > MAX_BYTES / 64) return value;
  const previous = c.entries.get(fullKey);
  if (previous) c.bytes -= previous.bytes;
  c.entries.set(fullKey, { value, expires: Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS), group, bytes });
  c.bytes += bytes;
  while (c.entries.size > MAX_ENTRIES || c.bytes > MAX_BYTES) {
    const oldest = c.entries.keys().next().value;
    if (oldest === undefined) break;
    c.bytes -= c.entries.get(oldest)!.bytes;
    c.entries.delete(oldest);
  }
  return value;
}

function estimate(value: unknown): number {
  try { return JSON.stringify(value)?.length ?? 64; } catch { return MAX_BYTES; }
}
