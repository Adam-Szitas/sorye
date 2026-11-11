/**
 * Customer-owned upload storage ("Connect your drive" / "Connect your database").
 *
 * A workspace on an eligible plan can send Drive uploads to its own
 * S3-compatible bucket or its own PostgreSQL database instead of Sorye's
 * storage. Hub owns the configuration, the upload ledger and every check;
 * the browser never sends a workspace id, an object key or a host to connect
 * to without validation. Design and threat model: docs/OWN-STORAGE.md.
 */
import type { SubscriptionTierId } from './subscription';

export const UPLOAD_TARGETS = ['sorye', 'drive', 'database'] as const;
export type UploadTarget = (typeof UPLOAD_TARGETS)[number];

/** Plans that may connect their own storage. */
export const OWN_STORAGE_TIERS: readonly SubscriptionTierId[] = ['pro', 'enterprise'];

export function ownStorageAllowed(tier: SubscriptionTierId): boolean {
  return OWN_STORAGE_TIERS.includes(tier);
}

export const DRIVE_PROVIDERS = ['aws-s3', 'cloudflare-r2', 's3-compatible'] as const;
export type DriveProvider = (typeof DRIVE_PROVIDERS)[number];

export const DATABASE_TLS_MODES = ['verify', 'encrypt', 'disable'] as const;
/**
 * `verify`: TLS with certificate and host name checks (default).
 * `encrypt`: TLS without certificate checks (encrypted, but open to an active man-in-the-middle).
 * `disable`: no TLS. Accepted only with OWN_STORAGE_DEV_INSECURE outside production.
 */
export type DatabaseTlsMode = (typeof DATABASE_TLS_MODES)[number];

const GIB = 1024 ** 3;
/** The storage limit the owner sets is between 1 GB and 100 TB. */
export const OWN_STORAGE_LIMIT_MIN_GB = 1;
export const OWN_STORAGE_LIMIT_MAX_GB = 100 * 1024;
export const OWN_STORAGE_DEFAULT_PREFIX = 'sorye/';
export const OWN_STORAGE_DEFAULT_SCHEMA = 'sorye_uploads';
export const OWN_STORAGE_DEFAULT_PORT = 5432;
/** Largest CA certificate bundle accepted for database TLS. */
export const OWN_STORAGE_CA_MAX_CHARS = 16_384;

export function gbToBytes(gb: number): number {
  return Math.round(gb * GIB);
}

/** What the owner sends to connect a drive. Secrets are write-only. */
export interface DriveConnectionInput {
  provider: DriveProvider;
  bucket: string;
  /** AWS region, or the region an S3-compatible service expects (often `auto` or `us-east-1`). */
  region: string;
  /** Cloudflare account id (R2 only). */
  accountId?: string;
  /** HTTPS origin of an S3-compatible service, e.g. `https://s3.eu-central-003.backblazeb2.com`. */
  endpoint?: string;
  /** Path-style addressing (`endpoint/bucket/key`); most S3-compatible services need it. */
  pathStyle?: boolean;
  /** Folder inside the bucket that Sorye may use. Ends with `/`. */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  limitGb: number;
}

/** What the owner sends to connect a database. The password is write-only. */
export interface DatabaseConnectionInput {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** Schema Sorye creates and uses; nothing outside it is touched. */
  schema: string;
  tls: DatabaseTlsMode;
  /** PEM certificate(s) of the server's certificate authority, for `verify` with a private CA. */
  caPem?: string;
  limitGb: number;
}

export type OwnStorageStatus = 'connected' | 'error';

/** Error codes shown to the owner. Never provider or driver messages. */
export const OWN_STORAGE_ERROR_CODES = [
  'invalid_input',
  'host_not_allowed',
  'host_unresolved',
  'unreachable',
  'tls_failed',
  'auth_failed',
  'not_found',
  'permission_denied',
  'timeout',
  'encryption_unavailable',
  'not_eligible',
  'not_owner',
  'quota_exceeded',
  'storage_unavailable',
  'integrity_failed',
  'target_not_ready',
  'in_use',
  'rate_limited',
  'unknown',
] as const;
export type OwnStorageErrorCode = (typeof OWN_STORAGE_ERROR_CODES)[number];

export interface StorageSpace {
  /** Bytes Sorye stored there and has not deleted, plus uploads in progress. */
  usedBytes: number;
  /** The limit the owner set. */
  limitBytes: number;
  freeBytes: number;
  fileCount: number;
}

/** Safe to send to any member. No secrets, no full connection details beyond what the owner typed as non-secret. */
export interface DriveConnectionPublic {
  provider: DriveProvider;
  bucket: string;
  region: string;
  accountId?: string;
  endpoint?: string;
  pathStyle: boolean;
  prefix: string;
  accessKeyHint: string;
  status: OwnStorageStatus;
  lastErrorCode: OwnStorageErrorCode | null;
  verifiedAt: string;
  updatedAt: string;
  space: StorageSpace;
}

export interface DatabaseConnectionPublic {
  host: string;
  port: number;
  database: string;
  user: string;
  schema: string;
  tls: DatabaseTlsMode;
  hasCustomCa: boolean;
  status: OwnStorageStatus;
  lastErrorCode: OwnStorageErrorCode | null;
  /** Bytes the Sorye table occupies on the server, including indexes; null when it could not be measured. */
  tableBytes: number | null;
  verifiedAt: string;
  updatedAt: string;
  space: StorageSpace;
}

export const UPLOAD_RECORD_STATUSES = ['pending', 'stored', 'failed', 'rejected', 'deleted'] as const;
export type UploadRecordStatus = (typeof UPLOAD_RECORD_STATUSES)[number];

/** One row of the upload ledger kept in Sorye's own database for every upload. */
export interface UploadRecord {
  id: string;
  workspaceId: string;
  /** Drive file id; null when the upload was rejected before a file existed. */
  fileId: string | null;
  userId: string;
  target: UploadTarget;
  /** Where the bytes are: object key in the bucket, row id in the customer table, or Sorye's blob key. */
  location: string | null;
  displayName: string;
  mime: string | null;
  size: number;
  sha256: string | null;
  sourceAppId: string;
  status: UploadRecordStatus;
  errorCode: OwnStorageErrorCode | 'file_rejected' | null;
  createdAt: string;
  completedAt: string | null;
}

export interface OwnStorageSnapshot {
  /** The workspace plan includes own storage. */
  eligible: boolean;
  /** The viewer owns the workspace and may change settings. */
  canManage: boolean;
  /** The Hub has STORAGE_SECRET_KEY and can store credentials. */
  encryptionReady: boolean;
  /** Development-only relaxation of host and TLS checks is on. */
  devInsecure: boolean;
  target: UploadTarget;
  drive: DriveConnectionPublic | null;
  database: DatabaseConnectionPublic | null;
  /** Latest uploads of this workspace, newest first. */
  recentUploads: UploadRecord[];
}

export type OwnStorageResult<T = OwnStorageSnapshot> =
  | { ok: true; snapshot: T }
  | { ok: false; code: OwnStorageErrorCode; field?: string };

export function isUploadTarget(value: unknown): value is UploadTarget {
  return typeof value === 'string' && (UPLOAD_TARGETS as readonly string[]).includes(value);
}
