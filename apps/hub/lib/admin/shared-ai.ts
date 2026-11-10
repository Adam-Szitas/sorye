import type {
  PlatformConfigConsumerState,
  PlatformConsumer,
  PropagationState,
  SharedAiConfigV1,
} from '@sorye/types';
import { getLlmControlSettings, getLlmControlSource, initializeLlmControl } from '@/lib/llm-control';
import { refreshPlatformConfig, platformWatcherStatus, rodrigoConfigured } from '@/lib/platform-config/watcher';
import {
  getPlatformConfig,
  getPlatformConfigApplied,
  putPlatformConfig,
  rollbackPlatformConfig,
  sharedAiConfigSchema,
} from '@/lib/rodrigo/platform-client';
import { RodrigoResponseError, RodrigoUnavailableError } from '@/lib/rodrigo/service-client';
import { assertSafeLlmBaseUrl } from '@/lib/security';
import type { AdminActor } from './access';

const NAMESPACE = 'shared-ai' as const;
/** A consumer that has not reported within this window is shown as unknown. */
const STALE_REPORT_MS = 3 * 60_000;
const EXPECTED_CONSUMERS: PlatformConsumer[] = ['hub', 'ocr-worker'];

export type StoreStatus = 'ready' | 'not_configured' | 'unavailable' | 'provider_unavailable';

export interface ConsumerView {
  consumer: PlatformConsumer;
  instanceId: string | null;
  appliedRevision: number | null;
  reportedAt: string | null;
  code: string | null;
  propagation: PropagationState;
}

export interface SharedAiView {
  namespace: typeof NAMESPACE;
  store: StoreStatus;
  revision: number;
  value: SharedAiConfigV1 | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Settings this Hub process is enforcing right now, and where they came from. */
  hubEffective: SharedAiConfigV1;
  hubSource: ReturnType<typeof getLlmControlSource>['source'];
  hubAppliedRevision: number;
  consumers: ConsumerView[];
  checkedAt: string;
}

function storeStatusFor(error: unknown): StoreStatus {
  if (error instanceof RodrigoResponseError && error.code === 'platform_provider_unavailable') return 'provider_unavailable';
  return 'unavailable';
}

export function propagationFor(
  consumer: PlatformConfigConsumerState | undefined,
  currentRevision: number,
  now = Date.now(),
): PropagationState {
  if (!consumer) return 'unknown';
  const reported = Date.parse(consumer.reportedAt);
  if (!Number.isFinite(reported) || now - reported > STALE_REPORT_MS) return 'unknown';
  if (consumer.appliedRevision === currentRevision) return consumer.status === 'applied' ? 'applied' : 'failed';
  if (consumer.status === 'failed' && consumer.appliedRevision > currentRevision) return 'failed';
  return 'pending';
}

function consumerViews(consumers: PlatformConfigConsumerState[], currentRevision: number): ConsumerView[] {
  const views: ConsumerView[] = [];
  for (const expected of EXPECTED_CONSUMERS) {
    // Every restart leaves a report from the previous process behind. Show instances that are
    // still reporting; if none are, show only the most recent one (as unknown), not the history.
    const reported = consumers
      .filter((entry) => entry.consumer === expected)
      .sort((left, right) => Date.parse(right.reportedAt) - Date.parse(left.reportedAt));
    const fresh = reported.filter((entry) => Date.now() - Date.parse(entry.reportedAt) <= STALE_REPORT_MS);
    const instances = fresh.length ? fresh : reported.slice(0, 1);
    if (!instances.length) {
      views.push({ consumer: expected, instanceId: null, appliedRevision: null, reportedAt: null, code: null, propagation: 'unknown' });
      continue;
    }
    const rows = instances.slice(0, 10).map((entry): ConsumerView => ({
      consumer: entry.consumer,
      instanceId: entry.instanceId,
      appliedRevision: entry.appliedRevision,
      reportedAt: entry.reportedAt,
      code: entry.code,
      propagation: propagationFor(entry, currentRevision),
    }));
    // Instances replaced by a restart stop reporting; once a live one reports, they are history, not drift.
    const live = rows.filter((row) => row.propagation !== 'unknown');
    views.push(...(live.length ? live : rows));
  }
  return views;
}

function hubEffective(): SharedAiConfigV1 {
  const settings = getLlmControlSettings();
  return { ...settings, gpuIndex: settings.gpuIndex ?? 0 };
}

export async function readSharedAi(actor: AdminActor): Promise<SharedAiView> {
  await initializeLlmControl();
  const local = getLlmControlSource();
  const base = {
    namespace: NAMESPACE,
    hubEffective: hubEffective(),
    hubSource: local.source,
    hubAppliedRevision: platformWatcherStatus()?.appliedRevision ?? local.platformRevision,
    checkedAt: new Date().toISOString(),
  };
  if (!rodrigoConfigured()) {
    return { ...base, store: 'not_configured', revision: 0, value: null, updatedAt: null, updatedBy: null, consumers: [] };
  }
  try {
    const [snapshot, applied] = await Promise.all([
      getPlatformConfig(actor.actorId, NAMESPACE),
      getPlatformConfigApplied(actor.actorId, NAMESPACE),
    ]);
    return {
      ...base,
      store: 'ready',
      revision: snapshot.revision,
      value: snapshot.value,
      updatedAt: snapshot.updatedAt,
      updatedBy: snapshot.updatedBy,
      consumers: consumerViews(applied.consumers, snapshot.revision),
    };
  } catch (error) {
    return { ...base, store: storeStatusFor(error), revision: 0, value: null, updatedAt: null, updatedBy: null, consumers: [] };
  }
}

export type SharedAiWriteResult =
  | { ok: true; status: 'committed' | 'duplicate'; revision: number; auditId: string; changeId: string; hubAppliedRevision: number }
  | { ok: false; httpStatus: number; error: string; detail?: string };

/** Hub-side checks that Rodrigo cannot make (the LLM host allowlist). */
export function validateSharedAiValue(raw: unknown): { ok: true; value: SharedAiConfigV1 } | { ok: false; detail: string } {
  const parsed = sharedAiConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, detail: `${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}` };
  }
  const value = { ...parsed.data, baseUrl: parsed.data.baseUrl.trim(), model: parsed.data.model.trim() };
  if (value.baseUrl) {
    try {
      assertSafeLlmBaseUrl(value.baseUrl);
    } catch (error) {
      return { ok: false, detail: `baseUrl: ${error instanceof Error ? error.message.replace('OCR_LLM_BASE_URL', 'Provider URL') : 'invalid'}` };
    }
  }
  return { ok: true, value };
}

function writeFailure(error: unknown): SharedAiWriteResult {
  if (error instanceof RodrigoResponseError) {
    const status = [400, 404, 409].includes(error.status) ? error.status : 503;
    return { ok: false, httpStatus: status, error: error.code };
  }
  if (error instanceof RodrigoUnavailableError) {
    // The write may or may not have committed; the client retries with the same changeId.
    return { ok: false, httpStatus: 503, error: 'config_store_unavailable', detail: 'Outcome unknown. Retry with the same change ID or reload to check the revision.' };
  }
  return { ok: false, httpStatus: 500, error: 'config_write_failed' };
}

async function afterCommit(revision: number): Promise<number> {
  const status = await refreshPlatformConfig('hub');
  return status.appliedRevision === revision ? revision : status.appliedRevision;
}

export async function writeSharedAi(actor: AdminActor, input: {
  changeId: string; expectedRevision: number; value: SharedAiConfigV1; reason?: string;
}): Promise<SharedAiWriteResult> {
  if (!rodrigoConfigured()) return { ok: false, httpStatus: 503, error: 'config_store_not_configured' };
  try {
    const commit = await putPlatformConfig(actor.actorId, NAMESPACE, {
      changeId: input.changeId,
      expectedRevision: input.expectedRevision,
      schemaVersion: 1,
      value: input.value,
      // Rodrigo digests the whole body; a retry must resend it byte-for-byte.
      correlationId: input.changeId,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    return { ok: true, status: commit.status, revision: commit.revision, auditId: commit.auditId, changeId: commit.changeId, hubAppliedRevision: await afterCommit(commit.revision) };
  } catch (error) {
    return writeFailure(error);
  }
}

export async function rollbackSharedAi(actor: AdminActor, input: {
  changeId: string; expectedRevision: number; targetRevision: number; reason?: string;
}): Promise<SharedAiWriteResult> {
  if (!rodrigoConfigured()) return { ok: false, httpStatus: 503, error: 'config_store_not_configured' };
  try {
    const commit = await rollbackPlatformConfig(actor.actorId, NAMESPACE, {
      changeId: input.changeId,
      expectedRevision: input.expectedRevision,
      targetRevision: input.targetRevision,
      correlationId: input.changeId,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    return { ok: true, status: commit.status, revision: commit.revision, auditId: commit.auditId, changeId: commit.changeId, hubAppliedRevision: await afterCommit(commit.revision) };
  } catch (error) {
    return writeFailure(error);
  }
}
