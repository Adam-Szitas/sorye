import { z } from 'zod';
import type { RodrigoDocumentKind } from '@sorye/types';

export class DocumentOwnershipError extends Error {
  constructor() { super('Document storage ownership is unavailable.'); }
}
const identity = {
  workspaceId: z.string().min(1).max(128),
  // Notes currently permits 512 KB; Rodrigo permits only 256 KiB per request.
  kind: z.enum(['tasks', 'calendar']),
};
const entrySchema = z.discriminatedUnion('owner', [
  z.object({ ...identity, owner: z.literal('frozen') }).strict(),
  z.object({ ...identity, owner: z.literal('rodrigo'),
    revisionOffset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 2),
  }).strict(),
]);
export type DocumentOwnership = { owner: 'hub' } | z.infer<typeof entrySchema>;

export function parseDocumentOwners(raw: string): Map<string, DocumentOwnership> {
  try {
    if (Buffer.byteLength(raw) > 65536) throw new Error('Too large');
    const entries = z.array(entrySchema).max(1000).parse(JSON.parse(raw));
    const result = new Map<string, DocumentOwnership>();
    for (const entry of entries) {
      const key = JSON.stringify([entry.workspaceId, entry.kind]);
      if (result.has(key)) throw new Error('Duplicate ownership');
      result.set(key, entry);
    }
    return result;
  } catch { throw new DocumentOwnershipError(); }
}

let cachedRaw: string | undefined;
let cachedOwners: Map<string, DocumentOwnership> | undefined;
/** Server deployment configuration only. Change on every replica while writes are drained. */
export function getDocumentOwner(workspaceId: string, kind: RodrigoDocumentKind): DocumentOwnership {
  const raw = process.env.RODRIGO_DOCUMENT_OWNERS ?? '[]';
  if (!cachedOwners || raw !== cachedRaw) {
    const parsed = parseDocumentOwners(raw); // Fail closed; never reuse stale config on an error.
    cachedOwners = parsed;
    cachedRaw = raw;
  }
  return cachedOwners.get(JSON.stringify([workspaceId, kind])) ?? { owner: 'hub' };
}

export function browserRevision(revision: number, offset: number): number {
  const value = revision + offset;
  if (!Number.isSafeInteger(value) || value < 0) throw new DocumentOwnershipError();
  return value;
}
