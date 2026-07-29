import { getDb } from '@sorye/db';
import * as schema from '@sorye/db/schema';
import {
  emptyCanvasDocument,
  type CanvasBoard,
  type CanvasBoardSummary,
  type CanvasDocument,
} from '@sorye/types';
import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { getHubSession } from './postgres-store';

async function assertMember(userId: string, workspaceId: string) {
  const session = await getHubSession(userId);
  if (!session) return null;
  if (session.workspace.id !== workspaceId) return null;
  if (!session.workspace.memberIds.includes(userId)) return null;
  return session;
}

function rowToBoard(row: typeof schema.canvasBoards.$inferSelect): CanvasBoard {
  const document = (row.document as unknown as CanvasDocument) ?? emptyCanvasDocument();
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revision: row.revision,
    document,
    itemCount: document.items?.length ?? 0,
  };
}

function toSummary(board: CanvasBoard): CanvasBoardSummary {
  return {
    id: board.id,
    workspaceId: board.workspaceId,
    title: board.title,
    createdBy: board.createdBy,
    updatedBy: board.updatedBy,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    revision: board.revision,
    itemCount: board.itemCount,
  };
}

export async function listCanvasBoards(
  userId: string,
  workspaceId: string,
): Promise<CanvasBoardSummary[] | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.canvasBoards)
    .where(eq(schema.canvasBoards.workspaceId, workspaceId))
    .orderBy(desc(schema.canvasBoards.updatedAt));
  return rows.map((row) => toSummary(rowToBoard(row)));
}

export async function getCanvasBoard(
  userId: string,
  workspaceId: string,
  boardId: string,
): Promise<CanvasBoard | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.canvasBoards)
    .where(
      and(
        eq(schema.canvasBoards.id, boardId),
        eq(schema.canvasBoards.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row ? rowToBoard(row) : null;
}

export async function createCanvasBoard(
  userId: string,
  workspaceId: string,
  title: string,
): Promise<CanvasBoard | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const db = getDb();
  const now = new Date();
  const document = emptyCanvasDocument();
  const id = `board-${randomUUID().slice(0, 8)}`;

  await db.insert(schema.canvasBoards).values({
    id,
    workspaceId,
    title: title.trim() || 'Untitled board',
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    document: document as unknown as {
      items: unknown[];
      viewport?: { x: number; y: number; zoom: number };
    },
  });

  return getCanvasBoard(userId, workspaceId, id);
}

export async function updateCanvasBoard(
  userId: string,
  workspaceId: string,
  boardId: string,
  patch: {
    title?: string;
    document?: CanvasDocument;
    expectedRevision?: number;
  },
): Promise<{ board: CanvasBoard } | { conflict: CanvasBoard } | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const current = await getCanvasBoard(userId, workspaceId, boardId);
  if (!current) return null;

  if (
    patch.expectedRevision !== undefined &&
    patch.expectedRevision !== current.revision
  ) {
    return { conflict: current };
  }

  const document = patch.document ?? current.document;
  const db = getDb();
  await db
    .update(schema.canvasBoards)
    .set({
      title: patch.title?.trim() || current.title,
      document: document as unknown as {
        items: unknown[];
        viewport?: { x: number; y: number; zoom: number };
      },
      updatedBy: userId,
      updatedAt: new Date(),
      revision: current.revision + 1,
    })
    .where(eq(schema.canvasBoards.id, boardId));

  const board = await getCanvasBoard(userId, workspaceId, boardId);
  return board ? { board } : null;
}

export async function deleteCanvasBoard(
  userId: string,
  workspaceId: string,
  boardId: string,
): Promise<boolean> {
  if (!(await assertMember(userId, workspaceId))) return false;
  const current = await getCanvasBoard(userId, workspaceId, boardId);
  if (!current) return false;
  const db = getDb();
  await db
    .delete(schema.canvasBoards)
    .where(eq(schema.canvasBoards.id, boardId));
  return true;
}
