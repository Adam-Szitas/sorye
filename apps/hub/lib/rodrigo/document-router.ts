import type { RodrigoDocument, RodrigoDocumentKind, RodrigoSnapshot } from '@sorye/types';
import { WorkspaceDocConflict, type WorkspaceDocWriteOptions } from '../store/workspace-doc-conflict';
import { browserRevision, DocumentOwnershipError, type DocumentOwnership } from './document-ownership';
import { RodrigoResponseError, type RodrigoContext } from './service-client';

export type DocumentRead = { access: 'denied' } | {
  access: 'ok'; doc: RodrigoDocument | null; revision?: number;
};
export class DocumentWritesFrozenError extends Error {
  constructor() { super('Document migration is in progress. Your draft has been kept; retry after migration.'); }
}
interface Dependencies {
  authorize: (context: RodrigoContext, kind: RodrigoDocumentKind) => Promise<boolean>;
  owner: (workspaceId: string, kind: RodrigoDocumentKind) => DocumentOwnership;
  legacyRead: (userId: string, workspaceId: string, kind: RodrigoDocumentKind) => Promise<DocumentRead>;
  legacyWrite: (userId: string, workspaceId: string, kind: RodrigoDocumentKind,
    payload: Record<string, unknown>, options?: WorkspaceDocWriteOptions) => Promise<RodrigoDocument | null>;
  snapshot: (context: RodrigoContext, kind: RodrigoDocumentKind) => Promise<RodrigoSnapshot>;
  write: (context: RodrigoContext, kind: RodrigoDocumentKind,
    input: { expectedRevision: number; payload: Record<string, unknown> }) => Promise<RodrigoDocument>;
}

/** Exactly one writer per workspace/kind. Remote failures never enter the Hub store. */
export function createDocumentRouter(deps: Dependencies) {
  return {
    async read(userId: string, workspaceId: string, kind: RodrigoDocumentKind): Promise<DocumentRead> {
      const context = { userId, workspaceId };
      if (!await deps.authorize(context, kind)) return { access: 'denied' };
      const owner = deps.owner(workspaceId, kind);
      if (owner.owner !== 'rodrigo') return deps.legacyRead(userId, workspaceId, kind);
      const snapshot = await deps.snapshot(context, kind);
      if (snapshot.revision === 0 && owner.revisionOffset > 0) throw new DocumentOwnershipError();
      const revision = browserRevision(snapshot.revision, owner.revisionOffset);
      return { access: 'ok', revision, doc: snapshot.document ? { ...snapshot.document, revision } : null };
    },
    async write(userId: string, workspaceId: string, kind: RodrigoDocumentKind,
      payload: Record<string, unknown>, options?: WorkspaceDocWriteOptions): Promise<RodrigoDocument | null> {
      const context = { userId, workspaceId };
      if (!await deps.authorize(context, kind)) return null;
      const owner = deps.owner(workspaceId, kind);
      if (owner.owner === 'hub') return deps.legacyWrite(userId, workspaceId, kind, payload, options);
      if (owner.owner === 'frozen') throw new DocumentWritesFrozenError();
      const offset = owner.revisionOffset;
      let expectedRevision: number;
      if (options?.migrate) {
        // Legacy browser imports are create-only, including after a deletion.
        const snapshot = await deps.snapshot(context, kind);
        if (snapshot.revision === 0 && offset > 0) throw new DocumentOwnershipError();
        if (snapshot.document) return { ...snapshot.document, revision: browserRevision(snapshot.revision, offset) };
        if (snapshot.revision !== 0) throw new WorkspaceDocConflict();
        expectedRevision = 0;
      } else {
        if (!Number.isSafeInteger(options?.expectedRevision)) throw new WorkspaceDocConflict();
        expectedRevision = options!.expectedRevision! - offset;
        if (expectedRevision < 0 || (expectedRevision === 0 && offset > 0) || expectedRevision >= Number.MAX_SAFE_INTEGER - offset) throw new WorkspaceDocConflict();
      }
      try {
        const saved = await deps.write(context, kind, { expectedRevision, payload });
        return { ...saved, revision: browserRevision(saved.revision, offset) };
      } catch (error) {
        if (error instanceof RodrigoResponseError && error.status === 409) throw new WorkspaceDocConflict();
        throw error;
      }
    },
  };
}
