import { getDb } from '@sorye/db';
import * as schema from '@sorye/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'crypto';
import type { EmbedWidget, EmbedWidgetCreated } from '@sorye/types';
import { normalizeOrigin } from '@sorye/types';
import { hashEmbedKey } from '@/lib/embed-token';

function toPublic(
  row: typeof schema.embedWidgets.$inferSelect,
): EmbedWidget {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    keyHint: row.keyHint,
    allowedOrigins: row.allowedOrigins,
    enabledAppIds: row.enabledAppIds,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    revokedAt: row.revokedAt?.toISOString(),
  };
}

function mintApiKey() {
  return `sk_embed_${randomBytes(24).toString('base64url')}`;
}

export async function listEmbedWidgets(
  workspaceId: string,
): Promise<EmbedWidget[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.embedWidgets)
    .where(
      and(
        eq(schema.embedWidgets.workspaceId, workspaceId),
        isNull(schema.embedWidgets.revokedAt),
      ),
    );

  return rows
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
  const db = getDb();
  const apiKey = mintApiKey();
  const id = `emb-${randomUUID().slice(0, 8)}`;
  const origins = input.allowedOrigins
    .map((o) => normalizeOrigin(o))
    .filter((o): o is string => Boolean(o));

  const [row] = await db
    .insert(schema.embedWidgets)
    .values({
      id,
      workspaceId: input.workspaceId,
      name: input.name.trim(),
      keyHash: hashEmbedKey(apiKey),
      keyHint: `••••${apiKey.slice(-4)}`,
      allowedOrigins: origins,
      enabledAppIds: [...new Set(input.enabledAppIds)],
      createdBy: input.createdBy,
    })
    .returning();

  return { ...toPublic(row!), apiKey };
}

export async function updateEmbedWidget(
  workspaceId: string,
  widgetId: string,
  patch: Partial<
    Pick<EmbedWidget, 'name' | 'allowedOrigins' | 'enabledAppIds'>
  >,
): Promise<EmbedWidget | null> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.embedWidgets)
    .where(
      and(
        eq(schema.embedWidgets.id, widgetId),
        eq(schema.embedWidgets.workspaceId, workspaceId),
        isNull(schema.embedWidgets.revokedAt),
      ),
    )
    .limit(1);

  if (!existing) return null;

  const [row] = await db
    .update(schema.embedWidgets)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.allowedOrigins !== undefined
        ? {
            allowedOrigins: patch.allowedOrigins
              .map((o) => normalizeOrigin(o))
              .filter((o): o is string => Boolean(o)),
          }
        : {}),
      ...(patch.enabledAppIds !== undefined
        ? { enabledAppIds: [...new Set(patch.enabledAppIds)] }
        : {}),
    })
    .where(eq(schema.embedWidgets.id, widgetId))
    .returning();

  return row ? toPublic(row) : null;
}

export async function revokeEmbedWidget(
  workspaceId: string,
  widgetId: string,
): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(schema.embedWidgets)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.embedWidgets.id, widgetId),
        eq(schema.embedWidgets.workspaceId, workspaceId),
        isNull(schema.embedWidgets.revokedAt),
      ),
    )
    .returning({ id: schema.embedWidgets.id });

  return updated.length > 0;
}

export async function findEmbedWidgetByKey(apiKey: string) {
  const db = getDb();
  const keyHash = hashEmbedKey(apiKey);
  const [row] = await db
    .select()
    .from(schema.embedWidgets)
    .where(
      and(
        eq(schema.embedWidgets.keyHash, keyHash),
        isNull(schema.embedWidgets.revokedAt),
      ),
    )
    .limit(1);

  if (!row) return null;
  return { ...toPublic(row), keyHash: row.keyHash };
}
