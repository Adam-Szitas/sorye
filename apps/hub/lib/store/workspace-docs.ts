import { getStoreDriver } from '@/lib/env';
import { withWorkspaceDb } from '@/lib/workspace-db';
import * as jsonStore from './workspace-docs-json';
import * as postgresStore from './workspace-docs-postgres';
import * as workspaceDb from './workspace-docs-workspace-db';
import type { WorkspaceDocKind } from './workspace-docs-json';

export type {
  WorkspaceAppDoc,
  WorkspaceDocKind,
  WorkspaceDocRead,
} from './workspace-docs-json';

function hubStore() {
  return getStoreDriver() === 'postgres' ? postgresStore : jsonStore;
}

export const getWorkspaceDoc = (
  userId: string,
  workspaceId: string,
  kind: WorkspaceDocKind,
) =>
  withWorkspaceDb(
    workspaceId,
    (db) => workspaceDb.getWorkspaceDoc(db, userId, workspaceId, kind),
    () => hubStore().getWorkspaceDoc(userId, workspaceId, kind),
  );

export const putWorkspaceDoc = (
  userId: string,
  workspaceId: string,
  kind: WorkspaceDocKind,
  payload: Record<string, unknown>,
  options?: { migrate?: boolean },
) =>
  withWorkspaceDb(
    workspaceId,
    (db) =>
      workspaceDb.putWorkspaceDoc(db, userId, workspaceId, kind, payload, options),
    () => hubStore().putWorkspaceDoc(userId, workspaceId, kind, payload, options),
  );
