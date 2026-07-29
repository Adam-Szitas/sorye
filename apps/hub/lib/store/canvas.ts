import { getStoreDriver } from '@/lib/env';
import { withWorkspaceDb } from '@/lib/workspace-db';
import * as jsonStore from './canvas-json';
import * as postgresStore from './canvas-postgres';
import * as workspaceDb from './canvas-workspace-db';

function hubStore() {
  return getStoreDriver() === 'postgres' ? postgresStore : jsonStore;
}

export const listCanvasBoards = (
  userId: string,
  workspaceId: string,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.listCanvasBoards(db, userId, workspaceId),
    () => hubStore().listCanvasBoards(userId, workspaceId),
  );

export const getCanvasBoard = (
  userId: string,
  workspaceId: string,
  boardId: string,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.getCanvasBoard(db, userId, workspaceId, boardId),
    () => hubStore().getCanvasBoard(userId, workspaceId, boardId),
  );

export const createCanvasBoard = (
  userId: string,
  workspaceId: string,
  title: string,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.createCanvasBoard(db, userId, workspaceId, title),
    () => hubStore().createCanvasBoard(userId, workspaceId, title),
  );

export const updateCanvasBoard = (
  userId: string,
  workspaceId: string,
  boardId: string,
  patch: Parameters<typeof postgresStore.updateCanvasBoard>[3],
) =>
  withWorkspaceDb(
    workspaceId,
    (db) =>
      workspaceDb.updateCanvasBoard(db, userId, workspaceId, boardId, patch),
    () => hubStore().updateCanvasBoard(userId, workspaceId, boardId, patch),
  );

export const deleteCanvasBoard = (
  userId: string,
  workspaceId: string,
  boardId: string,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.deleteCanvasBoard(db, userId, workspaceId, boardId),
    () => hubStore().deleteCanvasBoard(userId, workspaceId, boardId),
  );
