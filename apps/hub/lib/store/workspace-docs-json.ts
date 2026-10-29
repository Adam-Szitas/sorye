import { jsonDataFile } from './json-file';
import { getHubSession } from './json-store';
import { WorkspaceDocConflict, type WorkspaceDocWriteOptions } from './workspace-doc-conflict';

export type WorkspaceDocKind = 'tasks' | 'notes' | 'calendar';

export interface WorkspaceAppDoc {
  workspaceId: string;
  kind: WorkspaceDocKind;
  payload: Record<string, unknown>;
  updatedBy: string;
  updatedAt: string;
  revision: number;
}

interface WorkspaceDocsData {
  docs: Record<string, WorkspaceAppDoc>;
}

const storeFile = jsonDataFile<WorkspaceDocsData>('workspace-docs.json', () => ({
  docs: {},
}));

function docKey(workspaceId: string, kind: WorkspaceDocKind) {
  return `${workspaceId}:${kind}`;
}

async function assertMember(userId: string, workspaceId: string) {
  const session = await getHubSession(userId);
  if (!session) return null;
  if (session.workspace.id !== workspaceId) return null;
  if (!session.workspace.memberIds.includes(userId)) return null;
  return session;
}

export type WorkspaceDocRead =
  | { access: 'denied' }
  | { access: 'ok'; doc: WorkspaceAppDoc | null };

export async function getWorkspaceDoc(
  userId: string,
  workspaceId: string,
  kind: WorkspaceDocKind,
): Promise<WorkspaceDocRead> {
  if (!(await assertMember(userId, workspaceId))) return { access: 'denied' };
  const store = await storeFile.read();
  return { access: 'ok', doc: store.docs[docKey(workspaceId, kind)] ?? null };
}

export async function putWorkspaceDoc(
  userId: string,
  workspaceId: string,
  kind: WorkspaceDocKind,
  payload: Record<string, unknown>,
  options?: WorkspaceDocWriteOptions,
): Promise<WorkspaceAppDoc | null> {
  if (!(await assertMember(userId, workspaceId))) return null;
  const key = docKey(workspaceId, kind);
  return storeFile.update((store) => {
    const existing = store.docs[key];
    if (options?.migrate && existing) {
      return existing;
    }
    if (!options?.migrate && options?.expectedRevision !== (existing?.revision ?? 0)) {
      throw new WorkspaceDocConflict();
    }
    const next: WorkspaceAppDoc = {
      workspaceId,
      kind,
      payload,
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
      revision: (existing?.revision ?? 0) + 1,
    };
    store.docs[key] = next;
    return next;
  });
}
