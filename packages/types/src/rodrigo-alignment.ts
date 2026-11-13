/**
 * Hub ↔ Rodrigo alignment contract (Rodrigo OpenAPI 2.2.0, alignment version 1).
 * Rodrigo owns records, bytes, credentials, durable events and jobs; Hub is the session
 * gateway, streaming buffer, read cache and live fan-out. See docs/HUB-RODRIGO-BOUNDARY.md.
 */

/** Reserved assertion workspace for Hub service routes (`/v2/service/`). */
export const RODRIGO_SERVICE_WORKSPACE_ID = 'rodrigo-service' as const;
export const RODRIGO_SERVICE_HUB_ACTOR = 'service:hub' as const;

export const RODRIGO_ALIGNMENT_SLICES = ['plumbing', 'identity', 'storage', 'events', 'jobs', 'mail', 'domains', 'compute'] as const;
export type RodrigoAlignmentSlice = (typeof RODRIGO_ALIGNMENT_SLICES)[number];
export type RodrigoSliceStatus = 'not_implemented' | 'not_configured' | 'ready';

/** Object purposes: the app scope that owns an object. Hub signs `app:<purpose>`. */
export const RODRIGO_OBJECT_PURPOSES = ['files', 'tasks', 'messenger', 'ocr', 'mail', 'site', 'forms', 'protocolio', 'relay'] as const;
export type RodrigoObjectPurpose = (typeof RODRIGO_OBJECT_PURPOSES)[number];
export const RODRIGO_OBJECT_PART_BYTES = 8 * 1024 * 1024;
export const RODRIGO_OBJECT_MAX_BYTES = RODRIGO_OBJECT_PART_BYTES * 256;

export const RODRIGO_SERVICE_TOKEN_SERVICES = ['ocr', 'protocolio', 'ai'] as const;
export type RodrigoTokenService = (typeof RODRIGO_SERVICE_TOKEN_SERVICES)[number];
export const RODRIGO_SERVICE_TOKEN_MAX_TTL_SECONDS = 300;

export interface RodrigoAlignmentCapabilities {
  version: '1';
  slices: Record<RodrigoAlignmentSlice, RodrigoSliceStatus>;
  objects: { provider: 'not_configured' | 'ready'; maxObjectBytes: number; partBytes: number; purposes: RodrigoObjectPurpose[] };
  serviceTokens: { provider: 'not_configured' | 'ready'; maxTtlSeconds: number; services: RodrigoTokenService[] };
  changes: { provider: 'not_configured' | 'ready'; retentionHours: number; pageSize: number };
}

export interface RodrigoCreateUpload {
  objectId: string;
  purpose: RodrigoObjectPurpose;
  size: number;
  /** Lower-case hex SHA-256 of the whole object, as computed by the browser. */
  sha256: string;
  contentType: string;
}

export interface RodrigoUploadSession {
  contractVersion: '2';
  uploadId: string;
  objectId: string;
  partBytes: number;
  partCount: number;
  expiresAt: string;
  uploadedParts: Array<{ partNumber: number; sha256: string }>;
}

export interface RodrigoObjectMeta {
  contractVersion: '2';
  objectId: string;
  purpose: RodrigoObjectPurpose;
  size: number;
  sha256: string;
  contentType: string;
  status: 'ready';
  createdAt: string;
}

/** Machine codes an object upload can fail with. Damaged bytes are never stored. */
export type RodrigoObjectErrorCode =
  | 'checksum_mismatch' | 'integrity_failed' | 'object_exists' | 'object_id_reused'
  | 'object_too_large' | 'parts_missing' | 'upload_closed' | 'upload_not_found'
  | 'objects_provider_unavailable' | 'dependency_unavailable';

export interface RodrigoServiceTokenRequest {
  service: RodrigoTokenService;
  /** Lower-case `[a-z0-9._-]`, at most 64 characters, e.g. `ocr.recognize`. */
  operation: string;
  appId: string;
  ttlSeconds: number;
}

export interface RodrigoServiceToken {
  contractVersion: '2';
  token: string;
  audience: `sorye-${RodrigoTokenService}`;
  keyId: string;
  /** Unix seconds. */
  expiresAt: number;
}

/** Claims inside a Rodrigo service token (iss `rodrigo`, aud `sorye-<service>`). */
export interface RodrigoServiceTokenClaims {
  iss: 'rodrigo';
  aud: string;
  sub: string;
  workspaceId: string;
  service: RodrigoTokenService;
  operation: string;
  appId: string;
  iat: number;
  exp: number;
  jti: string;
}

/** One committed change. Identifiers and revision only: never a payload. */
export interface RodrigoChange {
  cursor: string;
  workspaceId: string;
  appId: string;
  resourceType: string;
  resourceId: string;
  revision: number;
  deleted: boolean;
  occurredAt: string;
}
