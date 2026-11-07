/** Rodrigo HTTP v1. Keep aligned with rodrigo.openapi.json and Rust fixtures. */
export const RODRIGO_CONTRACT_VERSION = '1' as const;
export type RodrigoAdapter = 'postgresql' | 'mongodb' | 'redis' | 's3';
export type RodrigoDocumentProvider = 'postgresql' | 'mysql' | 'mongodb';
export type RodrigoDocumentKind = 'tasks' | 'notes' | 'calendar';
export interface RodrigoCapabilities {
  contractVersion: '1'; service: 'rodrigo'; dataReady: boolean; operations: string[];
  adapters: Record<RodrigoAdapter, 'not_implemented' | 'not_configured' | 'ready'>;
}
export interface RodrigoErrorEnvelope { error: { code: string; requestId: string }; }
export interface RodrigoDocument { revision: number; payload: Record<string, unknown>; }
export interface RodrigoDocumentWrite { expectedRevision: number; payload: Record<string, unknown>; }
export interface RodrigoDocumentDelete { expectedRevision: number; }
export interface RodrigoSnapshot { revision: number; document: RodrigoDocument | null; }
export interface RodrigoChangeEvent { revision: number; deleted: boolean; }
export interface RodrigoCacheWrite { ttlSeconds: number; value: unknown; }
export interface RodrigoTopology {
  contractVersion: '1';
  documentOwners: Partial<Record<RodrigoDocumentKind, RodrigoDocumentProvider>>;
  documentProviders: RodrigoDocumentProvider[];
  storage: string[];
  cacheReady: boolean;
  events: { delivery: 'at-least-once-within-retention'; retainedRevisions: 1000; maxSubscribersPerReplica: 32 };
}
