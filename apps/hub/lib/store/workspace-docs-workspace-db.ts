import * as schema from '@sorye/db/schema';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceDb } from '@/lib/workspace-db';
import { getHubSession } from './postgres-store';
import type {
  WorkspaceAppDoc,
  WorkspaceDocKind,
  WorkspaceDocRead,
} from './workspace-docs-json';

async function assertMember(userId: string, workspaceId: string) {
  const session = await getHubSession(userId);
  if (!session) return null;
  if (session.workspace.id !== workspaceId) return null;
  if (!session.workspace.memberIds.includes(userId)) return null;
  return session;
}

function rowToDoc(
  row: typeof schema.workspaceAppDocs.$inferSelect,
): WorkspaceAppDoc {
  return {
    workspaceId: row.workspaceId,
    kind: row.kind as WorkspaceDocKind,
    payload: (row.payload as Record<string, unknown>) ?? {},
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
    revision: row.revision,
  };
}

export async function getWorkspaceDoc(
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
  kind: WorkspaceDocKind,
): Promise<WorkspaceDocRead> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const [row] = await db
    .select()
    .from(schema.workspaceAppDocs)
    .where(
      and(
        eq(schema.workspaceAppDocs.workspaceId, workspaceId),
        eq(schema.workspaceAppDocs.kind, kind),
      ),
    )
    .limit(1);
  return { access: 'ok', doc: row ? rowToDoc(row) : null };
}

export async function putWorkspaceDoc(
  db: WorkspaceDb,
  userId: string,
  workspaceId: string,
  kind: WorkspaceDocKind,
  payload: Record<string, unknown>,
  options?: { migrate?: boolean },
): Promise<WorkspaceAppDoc | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const current = await getWorkspaceDoc(db, userId, workspaceId, kind);
  if (current.access === 'denied') return null;
  const existing = current.doc;
  if (options?.migrate && existing) {
    return existing;
  }

  const now = new Date();
  const revision = (existing?.revision ?? 0) + 1;

  if (existing) {
    await db
      .update(schema.workspaceAppDocs)
      .set({
        payload,
        updatedBy: userId,
        updatedAt: now,
        revision,
      })
      .where(
        and(
          eq(schema.workspaceAppDocs.workspaceId, workspaceId),
          eq(schema.workspaceAppDocs.kind, kind),
        ),
      );
  } else {
    await db.insert(schema.workspaceAppDocs).values({
      workspaceId,
      kind,
      payload,
      updatedBy: userId,
      updatedAt: now,
      revision,
    });
  }

  const saved = await getWorkspaceDoc(db, userId, workspaceId, kind);
  return saved.access === 'ok' ? saved.doc : null;
}
