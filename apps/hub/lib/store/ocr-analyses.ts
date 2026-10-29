import { getStoreDriver } from '@/lib/env';
import { withWorkspaceDb } from '@/lib/workspace-db';
import * as jsonStore from './ocr-analyses-json';
import * as postgresStore from './ocr-analyses-postgres';
import * as workspaceDb from './ocr-analyses-workspace-db';

function hubStore() {
  return getStoreDriver() === 'postgres' ? postgresStore : jsonStore;
}

export const listOcrAnalyses = (userId: string, workspaceId: string, offset = 0) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.listOcrAnalyses(db, userId, workspaceId, offset),
    () => hubStore().listOcrAnalyses(userId, workspaceId, offset),
  );

export const getOcrAnalysis = (
  userId: string,
  workspaceId: string,
  id: string,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.getOcrAnalysis(db, userId, workspaceId, id),
    () => hubStore().getOcrAnalysis(userId, workspaceId, id),
  );

export const createOcrAnalysis = (
  userId: string,
  workspaceId: string,
  input: Parameters<typeof jsonStore.createOcrAnalysis>[2],
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.createOcrAnalysis(db, userId, workspaceId, input),
    () => hubStore().createOcrAnalysis(userId, workspaceId, input),
  );

export const queryOcrLibrary = (
  userId: string,
  workspaceId: string,
  query: Parameters<typeof jsonStore.queryOcrLibrary>[2],
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.queryOcrLibrary(db, userId, workspaceId, query),
    () => hubStore().queryOcrLibrary(userId, workspaceId, query),
  );

export const renameOcrAnalysis = (
  userId: string,
  workspaceId: string,
  id: string,
  fileName: string,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.renameOcrAnalysis(db, userId, workspaceId, id, fileName),
    () => hubStore().renameOcrAnalysis(userId, workspaceId, id, fileName),
  );

export const updateOcrAnalysis = (
  userId: string,
  workspaceId: string,
  id: string,
  patch: Parameters<typeof jsonStore.updateOcrAnalysis>[3],
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.updateOcrAnalysis(db, userId, workspaceId, id, patch),
    () => hubStore().updateOcrAnalysis(userId, workspaceId, id, patch),
  );
