/** Rodrigo versioned HTTP contracts. Keep aligned with authoritative OpenAPI and Rust DTOs. */
export const RODRIGO_CONTRACT_VERSION = '1' as const;
export const RODRIGO_ACTION_CONTRACT_VERSION = '2' as const;
export type RodrigoAdapter = 'postgresql' | 'mongodb' | 'redis' | 's3';
export type RodrigoDocumentProvider = 'postgresql' | 'mysql' | 'mongodb';
export type RodrigoDocumentKind = 'tasks' | 'notes' | 'calendar';
export interface RodrigoCapabilities {
  contractVersion: '1'; contractVersions: Array<'1' | '2'>; service: 'rodrigo'; dataReady: boolean; operations: string[];
  actions: { version: '2'; provider: 'not_configured' | 'ready'; maxBatchActions: 100; maxBodyBytes: 262144; maxCollectionPageSize: 100; families: string[] };
  adapters: Record<RodrigoAdapter, 'not_implemented' | 'not_configured' | 'ready'>;
  /** Rodrigo 2.1+: platform configuration and audit (see platform-config.ts). */
  platform?: { version: '1'; provider: 'not_configured' | 'ready'; namespaces: string[]; maxAuditPageSize: 100 };
}
export interface RodrigoErrorEnvelope { error: { code: string; requestId: string }; }
export type RodrigoActionAppId = 'tasks' | 'notes' | 'calendar' | 'workspace' | 'messenger' | 'files' | 'canvas' | 'mail' | 'relay' | 'site' | 'storefront' | 'ocr' | 'studio' | 'notifications' | 'events' | 'embed' | 'protocolio';
export type RodrigoActionResourceType = 'task' | 'taskBoard' | 'note' | 'event' | 'settings' | 'channel' | 'message' | 'reaction' | 'fileMetadata' | 'board' | 'account' | 'draft' | 'config' | 'page' | 'product' | 'order' | 'analysis' | 'pattern' | 'project' | 'notification' | 'widget' | 'artifact';
export type RodrigoActionOperation = 'create' | 'update' | 'delete';
export interface RodrigoAction {
  actionId: string; appId: RodrigoActionAppId; resourceType: RodrigoActionResourceType;
  operation: RodrigoActionOperation; resourceId: string; payloadVersion: 1;
  expectedRevision?: number;
  payload: Record<string, unknown>; occurredAt: string;
}
export interface RodrigoActionBatch { actions: RodrigoAction[]; }
export type RodrigoActionStatus = 'committed' | 'duplicate' | 'conflict' | 'rejected';
export interface RodrigoActionResult {
  actionId: string; status: RodrigoActionStatus; commitId?: string; revision?: number;
  result?: Record<string, unknown>; error?: { code: string; message: string };
}
export interface RodrigoActionBatchResult { contractVersion: '2'; results: RodrigoActionResult[]; }
export interface RodrigoResourceSnapshot { revision: number; resource: Record<string, unknown> | null; createdByUserId?: string; }
export interface RodrigoCollectionPage { items: Array<{ resourceId: string; revision: number; resource: Record<string, unknown>; createdByUserId?: string }>; nextCursor: string | null; }
export interface RodrigoMessengerMessagePage {
  messages: Array<{ resourceId: string; revision: number; createdByUserId?: string; resource: Record<string, unknown> }>;
  hasMore: boolean;
  nextCursor: string | null;
}
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
