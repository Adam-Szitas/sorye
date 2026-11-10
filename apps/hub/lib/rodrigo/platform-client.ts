import { z } from 'zod';
import {
  PLATFORM_CONFIG_NAMESPACES,
  RODRIGO_PLATFORM_WORKSPACE_ID,
  SHARED_AI_LIMITS,
  type PlatformAuditAppend,
  type PlatformAuditPage,
  type PlatformConfigApplied,
  type PlatformConfigAppliedReport,
  type PlatformConfigCommit,
  type PlatformConfigNamespace,
  type PlatformConfigRollback,
  type PlatformConfigSnapshot,
  type PlatformConfigWrite,
  type PlatformConsumer,
  type SharedAiConfigV1,
} from '@sorye/types';
import { rodrigoServiceRequest, type RodrigoContext } from './service-client';

const L = SHARED_AI_LIMITS;
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().min(1).max(64);
const uuid = z.string().uuid();
const namespaceSchema = z.enum(PLATFORM_CONFIG_NAMESPACES);
const consumerSchema = z.enum(['hub', 'ocr-worker']);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/;

function safeBaseUrl(value: string): boolean {
  if (value === '') return true;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Mirrors Rodrigo's SharedAiConfigV1 validation; Rodrigo remains authoritative. */
export const sharedAiConfigSchema = z.object({
  provider: z.enum(['ollama', 'vllm']),
  baseUrl: z.string().max(L.baseUrlMax).refine(safeBaseUrl, 'baseUrl must be http(s) without credentials, query or fragment'),
  model: z.string().max(L.modelMax).refine((value) => value === '' || (MODEL.test(value) && !value.includes('..')), 'invalid model id'),
  contextLength: z.number().int().min(L.contextLength[0]).max(L.contextLength[1]),
  maxOutputTokens: z.number().int().min(L.maxOutputTokens[0]).max(L.maxOutputTokens[1]),
  minFreeVramMiB: z.number().int().min(L.minFreeVramMiB[0]).max(L.minFreeVramMiB[1]),
  gpuIndex: z.number().int().min(L.gpuIndex[0]).max(L.gpuIndex[1]),
  paused: z.boolean(),
}).strict() satisfies z.ZodType<SharedAiConfigV1>;

const snapshotSchema = z.object({
  contractVersion: z.literal('2'),
  namespace: namespaceSchema,
  schemaVersion: z.literal(1),
  revision,
  value: sharedAiConfigSchema.nullable(),
  updatedAt: timestamp.nullable(),
  updatedBy: z.string().max(160).nullable(),
}).strict();

const commitSchema = z.object({
  contractVersion: z.literal('2'),
  status: z.enum(['committed', 'duplicate']),
  namespace: namespaceSchema,
  revision: revision.min(1),
  auditId: uuid,
  changeId: uuid,
}).strict();

const appliedSchema = z.object({
  contractVersion: z.literal('2'),
  namespace: namespaceSchema,
  currentRevision: revision,
  consumers: z.array(z.object({
    consumer: consumerSchema,
    instanceId: z.string().min(1).max(80),
    appliedRevision: revision,
    status: z.enum(['applied', 'failed']),
    code: z.string().max(64).nullable(),
    reportedAt: timestamp,
  }).strict()).max(50),
}).strict();

const auditPageSchema = z.object({
  contractVersion: z.literal('2'),
  events: z.array(z.object({
    auditId: uuid,
    occurredAt: timestamp,
    actorId: z.string().min(1).max(160),
    action: z.string().min(1).max(64),
    targetType: z.string().min(1).max(64),
    targetId: z.string().min(1).max(160),
    namespace: z.string().max(64).nullable(),
    revision: revision.nullable(),
    outcome: z.enum(['pending', 'succeeded', 'failed', 'denied', 'committed', 'conflict']),
    correlationId: uuid,
    changeId: uuid.nullable(),
    details: z.record(z.unknown()),
  }).strict()).max(100),
  nextCursor: z.string().max(256).nullable(),
}).strict();

function platformContext(actorId: string): RodrigoContext {
  return { userId: actorId, workspaceId: RODRIGO_PLATFORM_WORKSPACE_ID };
}

function configPath(namespace: PlatformConfigNamespace, suffix = ''): string {
  return `/v2/platform/config/${namespaceSchema.parse(namespace)}${suffix}`;
}

export function getPlatformConfig(actorId: string, namespace: PlatformConfigNamespace): Promise<PlatformConfigSnapshot> {
  return rodrigoServiceRequest(platformContext(actorId), configPath(namespace), 'platform:config:read', snapshotSchema);
}

export function putPlatformConfig(actorId: string, namespace: PlatformConfigNamespace, input: PlatformConfigWrite): Promise<PlatformConfigCommit> {
  return rodrigoServiceRequest(platformContext(actorId), configPath(namespace), 'platform:config:write', commitSchema, 'PUT', input);
}

export function rollbackPlatformConfig(actorId: string, namespace: PlatformConfigNamespace, input: PlatformConfigRollback): Promise<PlatformConfigCommit> {
  return rodrigoServiceRequest(platformContext(actorId), configPath(namespace, '/rollback'), 'platform:config:write', commitSchema, 'POST', input);
}

export function getPlatformConfigApplied(actorId: string, namespace: PlatformConfigNamespace): Promise<PlatformConfigApplied> {
  return rodrigoServiceRequest(platformContext(actorId), configPath(namespace, '/applied'), 'platform:config:read', appliedSchema);
}

export function serviceActor(consumer: PlatformConsumer): string {
  return `service:${consumer}`;
}

export function reportPlatformConfigApplied(namespace: PlatformConfigNamespace, input: PlatformConfigAppliedReport) {
  return rodrigoServiceRequest(platformContext(serviceActor(input.consumer)), configPath(namespace, '/applied'), 'platform:config:report',
    z.object({ contractVersion: z.literal('2'), recorded: z.literal(true) }).strict(), 'POST', input);
}

export function appendPlatformAudit(actorId: string, input: PlatformAuditAppend) {
  return rodrigoServiceRequest(platformContext(actorId), '/v2/platform/audit', 'platform:audit:write',
    z.object({ contractVersion: z.literal('2'), auditId: uuid, status: z.enum(['committed', 'duplicate']) }).strict(), 'POST', input);
}

export function listPlatformAudit(actorId: string, limit = 50, cursor?: string): Promise<PlatformAuditPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid audit page size.');
  if (cursor !== undefined && !/^(?:[0-9a-f]{2}){1,128}$/.test(cursor)) throw new Error('Invalid audit cursor.');
  return rodrigoServiceRequest(platformContext(actorId), `/v2/platform/audit/${limit}/${cursor ?? 'first'}`, 'platform:audit:read', auditPageSchema, 'GET', undefined, 262144);
}
