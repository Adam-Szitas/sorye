/**
 * Rodrigo-owned platform configuration and audit DTOs (contract v2, platform v1).
 * Keep aligned with Rodrigo `contracts/` and the reviewed snapshot in
 * `packages/types/contracts/rodrigo.openapi.json`.
 */
export const PLATFORM_CONFIG_NAMESPACES = ['shared-ai'] as const;
export type PlatformConfigNamespace = (typeof PLATFORM_CONFIG_NAMESPACES)[number];

/** Reserved Rodrigo grant for platform-scoped (not workspace-scoped) operations. */
export const RODRIGO_PLATFORM_WORKSPACE_ID = 'rodrigo-platform' as const;

export interface SharedAiConfigV1 {
  provider: 'ollama' | 'vllm';
  /** Empty disables the provider. http/https only; no credentials, query or fragment. */
  baseUrl: string;
  model: string;
  contextLength: number;
  maxOutputTokens: number;
  minFreeVramMiB: number;
  gpuIndex: number;
  /** New LLM requests are refused by every consumer that applied this revision. */
  paused: boolean;
}

export const SHARED_AI_LIMITS = {
  baseUrlMax: 240,
  modelMax: 80,
  contextLength: [2048, 8192],
  maxOutputTokens: [128, 1800],
  minFreeVramMiB: [512, 8192],
  gpuIndex: [0, 15],
} as const;

export interface PlatformConfigSnapshot<T = SharedAiConfigV1> {
  contractVersion: '2';
  namespace: PlatformConfigNamespace;
  schemaVersion: 1;
  /** 0 when no revision has been written. */
  revision: number;
  value: T | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface PlatformConfigWrite<T = SharedAiConfigV1> {
  changeId: string;
  expectedRevision: number;
  schemaVersion: 1;
  value: T;
  correlationId: string;
  reason?: string;
}

export interface PlatformConfigRollback {
  changeId: string;
  expectedRevision: number;
  targetRevision: number;
  correlationId: string;
  reason?: string;
}

export interface PlatformConfigCommit {
  contractVersion: '2';
  status: 'committed' | 'duplicate';
  namespace: PlatformConfigNamespace;
  revision: number;
  auditId: string;
  changeId: string;
}

/** Reporting consumer; its signed Rodrigo subject is `service:<consumer>`. */
export type PlatformConsumer = 'hub' | 'ocr-worker';

export interface PlatformConfigAppliedReport {
  consumer: PlatformConsumer;
  instanceId: string;
  appliedRevision: number;
  status: 'applied' | 'failed';
  code?: string;
}

export interface PlatformConfigConsumerState {
  consumer: PlatformConsumer;
  instanceId: string;
  appliedRevision: number;
  status: 'applied' | 'failed';
  code: string | null;
  reportedAt: string;
}

export interface PlatformConfigApplied {
  contractVersion: '2';
  namespace: PlatformConfigNamespace;
  currentRevision: number;
  consumers: PlatformConfigConsumerState[];
}

/** Outcomes a Hub-owned action may append. */
export type PlatformAuditOutcome = 'pending' | 'succeeded' | 'failed' | 'denied';
/** Outcomes in the trail: Rodrigo writes config rows as committed or conflict. */
export type PlatformAuditRecordedOutcome = PlatformAuditOutcome | 'committed' | 'conflict';

export interface PlatformAuditAppend {
  eventId: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: PlatformAuditOutcome;
  correlationId: string;
  /** Flat, non-secret values only. */
  details: Record<string, string | number | boolean | null>;
}

export interface PlatformAuditEvent {
  auditId: string;
  occurredAt: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  namespace: string | null;
  revision: number | null;
  outcome: PlatformAuditRecordedOutcome;
  correlationId: string;
  changeId: string | null;
  /** Flat for Hub-owned actions; `{ before, after, reason, rolledBackTo? }` for config rows. */
  details: Record<string, unknown>;
}

export interface PlatformAuditPage {
  contractVersion: '2';
  events: PlatformAuditEvent[];
  nextCursor: string | null;
}

/** Console view of one consumer's propagation state for the current revision. */
export type PropagationState = 'applied' | 'pending' | 'failed' | 'unknown';
