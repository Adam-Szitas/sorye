import { getStoreDriver } from '@/lib/env';
import { withWorkspaceDb } from '@/lib/workspace-db';
import * as jsonStore from './workspace-docs-json';
import * as postgresStore from './workspace-docs-postgres';
import * as workspaceDb from './workspace-docs-workspace-db';
import type { WorkspaceDocKind } from './workspace-docs-json';
import type { WorkspaceDocWriteOptions } from './workspace-doc-conflict';
import { getHubSessionForWorkspace } from './index';
import { getDocumentOwner } from '../rodrigo/document-ownership';
import { createDocumentRouter } from '../rodrigo/document-router';
import { getRodrigoSnapshot, putRodrigoDocument } from '../rodrigo/service-client';
import type { HubSession } from '@sorye/types';

export type {
  WorkspaceAppDoc,
  WorkspaceDocKind,
} from './workspace-docs-json';
export type { DocumentRead as WorkspaceDocRead } from '../rodrigo/document-router';

function hubStore() {
  return getStoreDriver() === 'postgres' ? postgresStore : jsonStore;
}

const readHubDocument = (
  userId: string,
  workspaceId: string,
  kind: WorkspaceDocKind,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.getWorkspaceDoc(db, userId, workspaceId, kind),
    () => hubStore().getWorkspaceDoc(userId, workspaceId, kind),
  );

const writeHubDocument = (
  userId: string,
  workspaceId: string,
  kind: WorkspaceDocKind,
  payload: Record<string, unknown>,
  options?: WorkspaceDocWriteOptions,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) =>
      workspaceDb.putWorkspaceDoc(db, userId, workspaceId, kind, payload, options),
    () => hubStore().putWorkspaceDoc(userId, workspaceId, kind, payload, options),
  );

// Routes may reuse ensureHubUser's trusted result to avoid another session DB read.
// Operator tools omit it and resolve membership from the server store.
function routerForSession(trustedSession?: HubSession) {
  return createDocumentRouter({
  authorize: async ({ userId, workspaceId }, kind) => {
    const session = trustedSession ?? await getHubSessionForWorkspace(userId, workspaceId);
    return Boolean(session && session.user.id === userId && session.workspace.id === workspaceId &&
      session.workspace.memberIds.includes(userId) && session.workspace.selectedAppIds.includes(kind));
  },
  owner: getDocumentOwner,
  legacyRead: readHubDocument,
  legacyWrite: writeHubDocument,
  snapshot: getRodrigoSnapshot,
  write: putRodrigoDocument,
});
}

export const getWorkspaceDoc = (userId: string, workspaceId: string, kind: WorkspaceDocKind, trustedSession?: HubSession) =>
  routerForSession(trustedSession).read(userId, workspaceId, kind);
export const putWorkspaceDoc = (userId: string, workspaceId: string, kind: WorkspaceDocKind,
  payload: Record<string, unknown>, options?: WorkspaceDocWriteOptions, trustedSession?: HubSession) =>
  routerForSession(trustedSession).write(userId, workspaceId, kind, payload, options);
