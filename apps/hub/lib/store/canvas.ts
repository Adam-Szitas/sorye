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
  _userId: string,
  _workspaceId: string,
  _title: string,
) => Promise.reject(new Error('canvas_authority_moved_to_rodrigo'));

export const updateCanvasBoard = (
  _userId: string,
  _workspaceId: string,
  _boardId: string,
  _patch: Parameters<typeof postgresStore.updateCanvasBoard>[3],
) => Promise.reject(new Error('canvas_authority_moved_to_rodrigo'));

export const deleteCanvasBoard = (_userId: string, _workspaceId: string, _boardId: string) =>
  Promise.reject(new Error('canvas_authority_moved_to_rodrigo'));
