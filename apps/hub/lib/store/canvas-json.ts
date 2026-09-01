import { randomUUID } from 'crypto';
import {
  emptyCanvasDocument,
  type CanvasBoard,
  type CanvasBoardSummary,
  type CanvasDocument,
} from '@sorye/types';
import { jsonDataFile } from './json-file';
import { getHubSession } from './json-store';

interface CanvasStoreData {
  boards: Record<string, CanvasBoard>;
}

const storeFile = jsonDataFile<CanvasStoreData>('canvas.json', () => ({
  boards: {},
}));

const readStore = () => storeFile.read();

async function assertMember(userId: string, workspaceId: string) {
  const session = await getHubSession(userId);
  if (!session) return null;
  if (session.workspace.id !== workspaceId) return null;
  if (!session.workspace.memberIds.includes(userId)) return null;
  return session;
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
    itemCount: board.document.items.length,
  };
}

export async function listCanvasBoards(
  userId: string,
  workspaceId: string,
): Promise<CanvasBoardSummary[] | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const store = await readStore();
  return Object.values(store.boards)
    .filter((b) => b.workspaceId === workspaceId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toSummary);
}

export async function getCanvasBoard(
  userId: string,
  workspaceId: string,
  boardId: string,
): Promise<CanvasBoard | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const store = await readStore();
  const board = store.boards[boardId];
  if (!board || board.workspaceId !== workspaceId) return null;
  return board;
}

export async function createCanvasBoard(
  userId: string,
  workspaceId: string,
  title: string,
): Promise<CanvasBoard | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const now = new Date().toISOString();
  const board: CanvasBoard = {
    id: `board-${randomUUID().slice(0, 8)}`,
    workspaceId,
    title: title.trim() || 'Untitled board',
    createdBy: userId,
    updatedBy: userId,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    document: emptyCanvasDocument(),
    itemCount: 0,
  };
  await storeFile.update((store) => {
    store.boards[board.id] = board;
  });
  return board;
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
  return storeFile.update((store) => {
    const board = store.boards[boardId];
    if (!board || board.workspaceId !== workspaceId) return null;

    if (
      patch.expectedRevision !== undefined &&
      patch.expectedRevision !== board.revision
    ) {
      return { conflict: board };
    }

    const next: CanvasBoard = {
      ...board,
      title: patch.title?.trim() || board.title,
      document: patch.document ?? board.document,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
      revision: board.revision + 1,
      itemCount: (patch.document ?? board.document).items.length,
    };

    store.boards[boardId] = next;
    return { board: next };
  });
}

export async function deleteCanvasBoard(
  userId: string,
  workspaceId: string,
  boardId: string,
): Promise<boolean> {
  if (!(await assertMember(userId, workspaceId))) return false;
  return storeFile.update((store) => {
    const board = store.boards[boardId];
    if (!board || board.workspaceId !== workspaceId) return false;
    delete store.boards[boardId];
    return true;
  });
}
