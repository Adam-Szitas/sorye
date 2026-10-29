export class WorkspaceDocConflict extends Error {
  constructor() {
    super('This workspace document changed in another session. Your draft has been kept; reload the latest version before merging your changes.');
    this.name = 'WorkspaceDocConflict';
  }
}

export type WorkspaceDocWriteOptions = { migrate?: boolean; expectedRevision?: number };
