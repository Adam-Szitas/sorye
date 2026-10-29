import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, getDb, isDatabaseConfigured } from '@sorye/db';
import { sharedState } from '@sorye/db/schema';
import { and, eq } from 'drizzle-orm';

type Strategy = 'workspace-map' | 'global';
const stores: Array<{ filename: string; strategy: Strategy }> = [
  ...[
    'cloud-storage.json', 'event-activated.json', 'event-settings.json', 'files-meta.json',
    'handoffs.json', 'mail.json', 'messenger-read.json', 'notification-read.json',
    'notification-settings.json', 'notifications.json', 'relay-storages.json', 'relay.json',
    'storefront-orders.json', 'storefront-products.json',
  ].map((filename) => ({ filename, strategy: 'workspace-map' as const })),
  ...[
    'llm-control.json', 'report-stats.json', 'site-pages.json',
  ].map((filename) => ({ filename, strategy: 'global' as const })),
];
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const WORKSPACE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function parseArgs(argv: string[]): { apply: boolean; dataDir: string } {
  let apply = false;
  let dataDir = path.resolve(process.env.SORYE_DATA_DIR ?? path.join(process.cwd(), '.data'));
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (arg === '--data-dir') {
      const value = argv[++i];
      if (!value) throw new Error('--data-dir requires a path');
      dataDir = path.resolve(value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { apply, dataDir };
}

async function migrate(): Promise<void> {
  const { apply, dataDir } = parseArgs(process.argv.slice(2));
  console.info(`JSON state import mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  console.info(`Source directory: ${dataDir}`);
  console.info('Stop Hub writers and take a verified backup before applying. Existing Postgres rows are never overwritten.');
  const canCheckTargets = isDatabaseConfigured();
  if (apply && !canCheckTargets) throw new Error('Set DATABASE_URL to the target Postgres database before using --apply');
  let rows = 0;
  let bytes = 0;
  let skipped = 0;

  for (const store of stores) {
    const filename = path.join(dataDir, store.filename);
    let size: number;
    try { size = (await stat(filename)).size; }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    if (size > MAX_SOURCE_BYTES) throw new Error(`${store.filename} exceeds the ${MAX_SOURCE_BYTES} byte safety limit`);
    const raw = JSON.parse(await readFile(filename, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${store.filename} must contain a JSON object`);
    const entries = store.strategy === 'global'
      ? [['@global', raw] as const]
      : Object.entries(raw as Record<string, unknown>).map(([scope, value]) => {
          if (!WORKSPACE_ID.test(scope) || scope === '@global') throw new Error(`${store.filename} contains an invalid workspace key`);
          return [scope, { [scope]: value }] as const;
        });
    console.info(`${store.filename}: ${size} bytes, ${entries.length} target row(s)`);
    bytes += size;

    for (const [scope, payload] of entries) {
      if (canCheckTargets) {
        const predicate = and(eq(sharedState.namespace, store.filename), eq(sharedState.scope, scope));
        const [existing] = await getDb().select({ namespace: sharedState.namespace }).from(sharedState).where(predicate).limit(1);
        if (existing) {
          skipped += 1;
          continue;
        }
      }
      if (apply) {
        await getDb().insert(sharedState).values({ namespace: store.filename, scope, payload })
          .onConflictDoNothing({ target: [sharedState.namespace, sharedState.scope] });
      }
      rows += 1;
    }
  }

  console.info(`${apply ? 'Imported' : 'Would import'} ${rows} row(s), ${bytes} source byte(s); left ${skipped} existing row(s) unchanged.`);
  if (!canCheckTargets) console.info('DATABASE_URL was not set; dry-run cannot inspect target rows. Existing-row conflicts are checked before each apply insert.');
  if (!apply) console.info('Review the source directory and counts, stop writes, back up Postgres and JSON, then rerun with --apply.');
  console.info('This imports only stores that use shared_state in Postgres mode. Identity, Messenger, Canvas, OCR, workspace documents/storage and other relational stores need dedicated migrations; Drive bytes under .data/files need a separate object-store migration.');
}

void migrate().catch((err: unknown) => {
  console.error('JSON state import failed:', err instanceof Error ? err.message : 'unknown error');
  process.exitCode = 1;
}).finally(() => closeDb().catch(() => undefined));
