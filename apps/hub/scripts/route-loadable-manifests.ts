import { existsSync, mkdirSync, readdirSync, writeFileSync, type Dirent } from 'node:fs';
import path from 'node:path';

/**
 * Development-only workaround for `next dev --turbopack` (measured on Next 15.5.20).
 *
 * For every route-handler request the dev server loads
 * `.next/server/app/<route>/route/react-loadable-manifest.json`. Turbopack emits
 * that file for pages only, so the loader fails, waits 100 ms, fails again, waits
 * another 100 ms and then falls back to an empty manifest. That is 200 ms of
 * timer wait in front of every `/api/*` call.
 *
 * Writing the empty manifest Next falls back to anyway removes the wait and
 * changes no behavior. `next build` clears `.next`, production never retries,
 * and Turbopack overwrites the file if a later version starts emitting it.
 */
export const ROUTE_LOADABLE_MANIFEST = 'react-loadable-manifest.json';

const ROUTE_SOURCE = /^route\.(?:ts|tsx|js|jsx|mjs)$/;
const ROUTE_MARKER = 'app-paths-manifest.json';
const SKIPPED_SOURCE_DIRS = new Set(['node_modules', '.next']);

function entries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function writeEmptyManifest(routeDir: string): boolean {
  const file = path.join(routeDir, ROUTE_LOADABLE_MANIFEST);
  if (existsSync(file)) return false;
  try {
    mkdirSync(routeDir, { recursive: true });
    // `wx` never replaces a manifest that Turbopack wrote in the meantime.
    writeFileSync(file, '{}', { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

/** Route handlers found in `app/`, as output directories relative to `.next/server/app`. */
export function routeDirsFromSource(appDir: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, relative: string[]) => {
    for (const entry of entries(dir)) {
      if (entry.isDirectory()) {
        if (SKIPPED_SOURCE_DIRS.has(entry.name) || entry.name.startsWith('_')) continue;
        walk(path.join(dir, entry.name), [...relative, entry.name]);
      } else if (ROUTE_SOURCE.test(entry.name)) {
        found.push(path.join(...relative, 'route'));
      }
    }
  };
  walk(appDir, []);
  return found;
}

/** Create the manifest for every known route before its first request. Returns files written. */
export function seedRouteManifests(appDir: string, outputAppDir: string): number {
  let written = 0;
  for (const relative of routeDirsFromSource(appDir)) {
    if (writeEmptyManifest(path.join(outputAppDir, relative))) written += 1;
  }
  return written;
}

/**
 * Cover routes whose output path is not derivable from `app/` (metadata routes
 * such as `sitemap.xml`) by looking at what Turbopack actually wrote.
 */
export function reconcileRouteManifests(outputAppDir: string): number {
  let written = 0;
  const walk = (dir: string) => {
    for (const entry of entries(dir)) {
      if (!entry.isDirectory()) continue;
      const child = path.join(dir, entry.name);
      if (entry.name === 'route') {
        if (existsSync(path.join(child, ROUTE_MARKER)) && writeEmptyManifest(child)) written += 1;
        continue;
      }
      // Page output directories hold manifests only; there is nothing below them.
      if (entry.name === 'page') continue;
      walk(child);
    }
  };
  walk(outputAppDir);
  return written;
}

/** Seed now, then keep reconciling while the dev server runs. Returns a stop function. */
export function startRouteManifestShim(
  hubRoot: string,
  options: { intervalMs?: number; distDir?: string } = {},
): () => void {
  const appDir = path.join(hubRoot, 'app');
  const outputAppDir = path.join(hubRoot, options.distDir ?? '.next', 'server', 'app');
  seedRouteManifests(appDir, outputAppDir);
  reconcileRouteManifests(outputAppDir);
  const timer = setInterval(() => {
    // A removed `.next` (rebuild, manual clean) is seeded again on the next tick.
    if (!existsSync(outputAppDir)) seedRouteManifests(appDir, outputAppDir);
    else reconcileRouteManifests(outputAppDir);
  }, options.intervalMs ?? 2_000);
  timer.unref();
  return () => clearInterval(timer);
}
