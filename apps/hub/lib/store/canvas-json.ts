import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
  emptyCanvasDocument,
  type CanvasBoard,
  type CanvasBoardSummary,
  type CanvasDocument,
} from '@sorye/types';
import { getHubSession } from './json-store';

interface CanvasStoreData {
  boards: Record<string, CanvasBoard>;
}

const DATA_DIR = path.join(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'canvas.json');
const DEFAULT_STORE: CanvasStoreData = { boards: {} };

async function readStore(): Promise<CanvasStoreData> {
  try {
    const raw = await readFile(STORE_PATH, 'utf-8');
    return JSON.parse(raw) as CanvasStoreData;
  } catch {
    return structuredClone(DEFAULT_STORE);
  }
}

async function writeStore(data: CanvasStoreData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

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
  const store = await readStore();
  store.boards[board.id] = board;
  await writeStore(store);
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
  const store = await readStore();
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
  await writeStore(store);
  return { board: next };
}

export async function deleteCanvasBoard(
  userId: string,
  workspaceId: string,
  boardId: string,
): Promise<boolean> {
  if (!(await assertMember(userId, workspaceId))) return false;
  const store = await readStore();
  const board = store.boards[boardId];
  if (!board || board.workspaceId !== workspaceId) return false;
  delete store.boards[boardId];
  await writeStore(store);
  return true;
}
