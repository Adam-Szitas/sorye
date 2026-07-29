import { createHash, randomBytes, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import type { EmbedWidget, EmbedWidgetCreated } from '@sorye/types';
import { normalizeOrigin } from '@sorye/types';
import { hashEmbedKey } from '@/lib/embed-token';

interface EmbedStoreData {
  widgets: Record<string, EmbedWidget & { keyHash: string }>;
}

const DATA_DIR = path.join(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'embed.json');

async function readStore(): Promise<EmbedStoreData> {
  try {
    const raw = await readFile(STORE_PATH, 'utf-8');
    return JSON.parse(raw) as EmbedStoreData;
  } catch {
    return { widgets: {} };
  }
}

async function writeStore(data: EmbedStoreData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(data, null, 2));
}

function toPublic(row: EmbedWidget & { keyHash: string }): EmbedWidget {
  const { keyHash: _hash, ...rest } = row;
  return rest;
}

function mintApiKey() {
  return `sk_embed_${randomBytes(24).toString('base64url')}`;
}

export async function listEmbedWidgets(
  workspaceId: string,
): Promise<EmbedWidget[]> {
  const store = await readStore();
  return Object.values(store.widgets)
    .filter((w) => w.workspaceId === workspaceId && !w.revokedAt)
    .map(toPublic)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createEmbedWidget(input: {
  workspaceId: string;
  createdBy: string;
  name: string;
  allowedOrigins: string[];
  enabledAppIds: string[];
}): Promise<EmbedWidgetCreated> {
  const store = await readStore();
  const apiKey = mintApiKey();
  const id = `emb-${randomUUID().slice(0, 8)}`;
  const origins = input.allowedOrigins
    .map((o) => normalizeOrigin(o))
    .filter((o): o is string => Boolean(o));

  const row: EmbedWidget & { keyHash: string } = {
    id,
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    keyHash: hashEmbedKey(apiKey),
    keyHint: `••••${apiKey.slice(-4)}`,
    allowedOrigins: origins,
    enabledAppIds: [...new Set(input.enabledAppIds)],
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  };

  store.widgets[id] = row;
  await writeStore(store);

  return { ...toPublic(row), apiKey };
}

export async function updateEmbedWidget(
  workspaceId: string,
  widgetId: string,
  patch: Partial<
    Pick<EmbedWidget, 'name' | 'allowedOrigins' | 'enabledAppIds'>
  >,
): Promise<EmbedWidget | null> {
  const store = await readStore();
  const row = store.widgets[widgetId];
  if (!row || row.workspaceId !== workspaceId || row.revokedAt) return null;

  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.allowedOrigins !== undefined) {
    row.allowedOrigins = patch.allowedOrigins
      .map((o) => normalizeOrigin(o))
      .filter((o): o is string => Boolean(o));
  }
  if (patch.enabledAppIds !== undefined) {
    row.enabledAppIds = [...new Set(patch.enabledAppIds)];
  }

  store.widgets[widgetId] = row;
  await writeStore(store);
  return toPublic(row);
}

export async function revokeEmbedWidget(
  workspaceId: string,
  widgetId: string,
): Promise<boolean> {
  const store = await readStore();
  const row = store.widgets[widgetId];
  if (!row || row.workspaceId !== workspaceId || row.revokedAt) return false;
  row.revokedAt = new Date().toISOString();
  store.widgets[widgetId] = row;
  await writeStore(store);
  return true;
}

export async function findEmbedWidgetByKey(apiKey: string): Promise<
  | (EmbedWidget & {
      keyHash: string;
    })
  | null
> {
  const store = await readStore();
  const keyHash = hashEmbedKey(apiKey);
  const row = Object.values(store.widgets).find(
    (w) => w.keyHash === keyHash && !w.revokedAt,
  );
  return row ?? null;
}

/** Stable fingerprint for logging — not reversible to the key. */
export function embedKeyFingerprint(apiKey: string) {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
}
