import {
  DATABASE_TLS_MODES,
  DRIVE_PROVIDERS,
  OWN_STORAGE_CA_MAX_CHARS,
  OWN_STORAGE_DEFAULT_PORT,
  OWN_STORAGE_DEFAULT_PREFIX,
  OWN_STORAGE_DEFAULT_SCHEMA,
  OWN_STORAGE_LIMIT_MAX_GB,
  OWN_STORAGE_LIMIT_MIN_GB,
  type DatabaseTlsMode,
  type DriveProvider,
} from '@sorye/types';
import { normalizeHost } from './net-guard';

/**
 * Strict validation of what the owner types into "Connect your drive" and
 * "Connect your database". Pure functions: no I/O, no secrets in errors.
 */

export class InputError extends Error {
  constructor(readonly field: string) {
    super(`invalid ${field}`);
    this.name = 'InputError';
  }
}

export interface DriveConfig {
  provider: DriveProvider;
  bucket: string;
  region: string;
  accountId?: string;
  /** HTTPS origin, set only for `s3-compatible`. */
  endpoint?: string;
  pathStyle: boolean;
  prefix: string;
  limitBytes: number;
}

export interface DriveSecret {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  schema: string;
  tls: DatabaseTlsMode;
  limitBytes: number;
}

export interface DatabaseSecret {
  password: string;
  caPem?: string;
}

const PRINTABLE_TOKEN_RE = /^[\x21-\x7e]{8,256}$/;
const AWS_REGION_RE = /^[a-z]{2}(?:-gov|-iso[a-z]?)?-[a-z]+-\d{1,2}$/;
const GENERIC_REGION_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const R2_ACCOUNT_RE = /^[a-f0-9]{32}$/;
const PREFIX_RE = /^(?:[A-Za-z0-9._-]+\/){1,10}$/;
const DB_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_$-]{0,62}$/;
const DB_USER_RE = /^[A-Za-z0-9_][A-Za-z0-9_.@$-]{0,62}$/;
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const RESERVED_SCHEMAS = new Set(['public', 'information_schema']);
const PEM_BUNDLE_RE = /^(?:\s*-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*)+$/;

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new InputError(field);
  return value.trim();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new InputError(field);
  return value as T;
}

export function validateLimitGb(value: unknown): number {
  const gb = typeof value === 'string' ? Number(value) : value;
  if (typeof gb !== 'number' || !Number.isFinite(gb) || gb < OWN_STORAGE_LIMIT_MIN_GB || gb > OWN_STORAGE_LIMIT_MAX_GB) {
    throw new InputError('limitGb');
  }
  // Whole megabytes are precise enough and keep the stored number an integer.
  return Math.round(gb * 1024) * 1024 * 1024;
}

export function validateBucket(value: unknown): string {
  const bucket = text(value, 'bucket');
  if (
    bucket.length < 3 || bucket.length > 63 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) ||
    /\.\.|\.-|-\./.test(bucket) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(bucket) ||
    bucket.startsWith('xn--') || bucket.endsWith('-s3alias')
  ) {
    throw new InputError('bucket');
  }
  return bucket;
}

export function validatePrefix(value: unknown): string {
  const raw = value === undefined || value === '' ? OWN_STORAGE_DEFAULT_PREFIX : text(value, 'prefix');
  const prefix = raw.endsWith('/') ? raw : `${raw}/`;
  if (prefix.length > 200 || !PREFIX_RE.test(prefix) || prefix.split('/').some((part) => part === '.' || part === '..')) {
    throw new InputError('prefix');
  }
  return prefix;
}

/** HTTPS origin only: no credentials, path, query or fragment. */
export function validateEndpoint(value: unknown, allowInsecure: boolean): string {
  const raw = text(value, 'endpoint');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InputError('endpoint');
  }
  const schemeOk = url.protocol === 'https:' || (allowInsecure && url.protocol === 'http:');
  if (!schemeOk || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new InputError('endpoint');
  }
  const host = normalizeHost(url.hostname, allowInsecure);
  if (!host) throw new InputError('endpoint');
  return url.origin;
}

export function validateDriveInput(input: Record<string, unknown>, allowInsecure: boolean): { config: DriveConfig; secret: DriveSecret } {
  const provider = oneOf(input.provider, DRIVE_PROVIDERS, 'provider');
  const bucket = validateBucket(input.bucket);
  let region: string;
  let accountId: string | undefined;
  let endpoint: string | undefined;
  let pathStyle: boolean;
  if (provider === 'aws-s3') {
    region = text(input.region, 'region');
    if (!AWS_REGION_RE.test(region)) throw new InputError('region');
    // Virtual-hosted style is AWS's default; bucket names with dots need path style.
    pathStyle = bucket.includes('.');
  } else if (provider === 'cloudflare-r2') {
    region = 'auto';
    accountId = text(input.accountId, 'accountId').toLowerCase();
    if (!R2_ACCOUNT_RE.test(accountId)) throw new InputError('accountId');
    pathStyle = true;
  } else {
    region = input.region === undefined || input.region === '' ? 'us-east-1' : text(input.region, 'region');
    if (!GENERIC_REGION_RE.test(region)) throw new InputError('region');
    endpoint = validateEndpoint(input.endpoint, allowInsecure);
    if (input.pathStyle !== undefined && typeof input.pathStyle !== 'boolean') throw new InputError('pathStyle');
    pathStyle = input.pathStyle !== false;
  }
  const accessKeyId = typeof input.accessKeyId === 'string' ? input.accessKeyId : '';
  const secretAccessKey = typeof input.secretAccessKey === 'string' ? input.secretAccessKey : '';
  if (!PRINTABLE_TOKEN_RE.test(accessKeyId)) throw new InputError('accessKeyId');
  if (!PRINTABLE_TOKEN_RE.test(secretAccessKey)) throw new InputError('secretAccessKey');
  return {
    config: { provider, bucket, region, accountId, endpoint, pathStyle, prefix: validatePrefix(input.prefix), limitBytes: validateLimitGb(input.limitGb) },
    secret: { accessKeyId, secretAccessKey },
  };
}

export function validateDatabaseInput(input: Record<string, unknown>, allowInsecure: boolean): { config: DatabaseConfig; secret: DatabaseSecret } {
  const host = normalizeHost(text(input.host, 'host'), allowInsecure);
  if (!host) throw new InputError('host');
  const port = input.port === undefined || input.port === '' ? OWN_STORAGE_DEFAULT_PORT : Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new InputError('port');
  const database = text(input.database, 'database');
  if (!DB_NAME_RE.test(database)) throw new InputError('database');
  const user = text(input.user, 'user');
  if (!DB_USER_RE.test(user)) throw new InputError('user');
  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < 1 || password.length > 512 || /[\u0000-\u001f\u007f]/.test(password)) throw new InputError('password');
  const schema = input.schema === undefined || input.schema === '' ? OWN_STORAGE_DEFAULT_SCHEMA : text(input.schema, 'schema');
  if (!SCHEMA_RE.test(schema) || RESERVED_SCHEMAS.has(schema) || schema.startsWith('pg_')) throw new InputError('schema');
  const tls = oneOf(input.tls ?? 'verify', DATABASE_TLS_MODES, 'tls');
  if (tls === 'disable' && !allowInsecure) throw new InputError('tls');
  let caPem: string | undefined;
  if (input.caPem !== undefined && input.caPem !== '') {
    if (typeof input.caPem !== 'string' || input.caPem.length > OWN_STORAGE_CA_MAX_CHARS || !PEM_BUNDLE_RE.test(input.caPem)) {
      throw new InputError('caPem');
    }
    if (tls !== 'verify') throw new InputError('caPem');
    caPem = input.caPem.trim();
  }
  return {
    config: { host, port, database, user, schema, tls, limitBytes: validateLimitGb(input.limitGb) },
    secret: { password, ...(caPem ? { caPem } : {}) },
  };
}

/** Last four characters of a key id, for recognising which key is in use. */
export function keyHint(accessKeyId: string): string {
  return accessKeyId.length > 8 ? accessKeyId.slice(-4) : '';
}
