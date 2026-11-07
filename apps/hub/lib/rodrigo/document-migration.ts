import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { RodrigoDocument, RodrigoDocumentKind, RodrigoSnapshot } from '@sorye/types';
import { parseTasksBoard, parseCalendarEvents } from '../workspace-docs-validate';
import { browserRevision } from './document-ownership';
import type { RodrigoContext } from './service-client';

const document = z.object({ revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 2), payload: z.record(z.unknown()) }).strict();
export const migrationExportSchema = z.object({
  format: z.literal('sorye-rodrigo-document-v1'),
  userId: z.string().min(1).max(128), workspaceId: z.string().min(1).max(128),
  kind: z.enum(['tasks', 'calendar']), document: document.nullable(),
}).strict();
export type MigrationExport = z.infer<typeof migrationExportSchema>;

export function validateMigrationExport(value: unknown): MigrationExport {
  const source = migrationExportSchema.parse(value);
  if (source.document) {
    const payload = source.document.payload;
    // Refuse migration if existing domain validation would drop or rewrite data.
    const normalized = source.kind === 'tasks'
      ? { board: parseTasksBoard(payload.board ?? payload) }
      : { events: parseCalendarEvents(payload.events ?? payload) };
    if (!isDeepStrictEqual(normalized, payload)) throw new Error('Source document requires normalization before migration.');
    if (Buffer.byteLength(JSON.stringify({ expectedRevision: 0, payload })) > 262144) {
      throw new Error('Source exceeds the Rodrigo request limit.');
    }
  }
  return source;
}

interface MigrationBackend {
  snapshot(context: RodrigoContext, kind: RodrigoDocumentKind): Promise<RodrigoSnapshot>;
  write(context: RodrigoContext, kind: RodrigoDocumentKind,
    input: { expectedRevision: number; payload: Record<string, unknown> }): Promise<RodrigoDocument>;
}

/** Caller must quiesce every writer and verify the source still equals this export. */
export async function importDocument(source: MigrationExport, backend: MigrationBackend, apply: boolean) {
  source = validateMigrationExport(source);
  const context = { userId: source.userId, workspaceId: source.workspaceId };
  const before = await backend.snapshot(context, source.kind);
  const matchesImport = (snapshot: RodrigoSnapshot) => source.document
    ? snapshot.revision === 1 && snapshot.document?.revision === 1 && isDeepStrictEqual(snapshot.document.payload, source.document.payload)
    : snapshot.revision === 0 && snapshot.document === null;
  const pristine = before.revision === 0 && before.document === null;
  if (!pristine && !matchesImport(before)) throw new Error('Target is not pristine or has changed since import.');
  if (apply && source.document && pristine) {
    // If this response is lost, leave the source frozen. A rerun reconciles via snapshot.
    await backend.write(context, source.kind, { expectedRevision: 0, payload: source.document.payload });
  }
  if (!apply) return { verified: false as const, targetRevision: before.revision };
  const after = await backend.snapshot(context, source.kind);
  if (!matchesImport(after)) throw new Error('Target verification failed. Keep writes frozen.');
  const revisionOffset = source.document?.revision ?? 0;
  return { verified: true as const, targetRevision: after.revision,
    browserRevision: browserRevision(after.revision, revisionOffset),
    owner: { workspaceId: source.workspaceId, kind: source.kind, owner: 'rodrigo' as const, revisionOffset },
  };
}
