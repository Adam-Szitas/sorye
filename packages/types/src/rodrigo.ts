/** Rodrigo HTTP v1. Keep aligned with contracts/rodrigo.openapi.json and Rust fixtures. */
export const RODRIGO_CONTRACT_VERSION = '1' as const;
export type RodrigoAdapter = 'postgresql' | 'mongodb' | 'redis' | 's3';
export interface RodrigoCapabilities {
  contractVersion: '1';
  service: 'rodrigo';
  dataReady: boolean;
  operations: string[];
  adapters: Record<RodrigoAdapter, 'not_implemented' | 'not_configured' | 'ready'>;
}
export interface RodrigoErrorEnvelope {
  error: { code: string; requestId: string };
}
export interface RodrigoDocument {
  revision: number;
  payload: Record<string, unknown>;
}
export interface RodrigoDocumentWrite {
  expectedRevision: number;
  payload: Record<string, unknown>;
}
