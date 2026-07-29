import { getStoreDriver } from '@/lib/env';
import { withWorkspaceDb } from '@/lib/workspace-db';
import * as jsonStore from './messenger-json';
import * as postgresStore from './messenger-postgres';
import * as workspaceDb from './messenger-workspace-db';

function hubStore() {
  return getStoreDriver() === 'postgres' ? postgresStore : jsonStore;
}

export const bootstrapMessenger = (userId: string, workspaceId: string) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.bootstrapMessenger(db, userId, workspaceId),
    () => hubStore().bootstrapMessenger(userId, workspaceId),
  );

export const openDirectMessage = (
  userId: string,
  workspaceId: string,
  peerUserId: string,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.openDirectMessage(db, userId, workspaceId, peerUserId),
    () => hubStore().openDirectMessage(userId, workspaceId, peerUserId),
  );

export const createPublicChannel = (
  userId: string,
  workspaceId: string,
  name: string,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.createPublicChannel(db, userId, workspaceId, name),
    () => hubStore().createPublicChannel(userId, workspaceId, name),
  );

export const postMessage = (
  userId: string,
  workspaceId: string,
  input: Parameters<typeof postgresStore.postMessage>[2],
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.postMessage(db, userId, workspaceId, input),
    () => hubStore().postMessage(userId, workspaceId, input),
  );

export const listMessages = (
  userId: string,
  workspaceId: string,
  channelId: string,
  after?: string,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.listMessages(db, userId, workspaceId, channelId, after),
    () => hubStore().listMessages(userId, workspaceId, channelId, after),
  );

export const ensureEventsChannel = (
  workspaceId: string,
  createdBy: string,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.ensureEventsChannel(db, workspaceId, createdBy),
    () => hubStore().ensureEventsChannel(workspaceId, createdBy),
  );

export const postSystemMessage = (
  workspaceId: string,
  channelId: string,
  text: string,
  author: { id: string; name: string; image?: string },
) =>
  withWorkspaceDb(
    workspaceId,
    (db) =>
      workspaceDb.postSystemMessage(db, workspaceId, channelId, text, author),
    () => hubStore().postSystemMessage(workspaceId, channelId, text, author),
  );
