import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import type { PlatformConsumer, SharedAiConfigV1 } from '@sorye/types';
import { applyPlatformLlmSettings, getLlmControlSource, logLlmActivity } from '@/lib/llm-control';
import { RodrigoResponseError } from '@/lib/rodrigo/service-client';
import { getPlatformConfig, reportPlatformConfigApplied, serviceActor, sharedAiConfigSchema } from '@/lib/rodrigo/platform-client';

const NAMESPACE = 'shared-ai' as const;
const REPORT_REFRESH_MS = 60_000;

export interface WatcherStatus {
  consumer: PlatformConsumer;
  instanceId: string;
  configured: boolean;
  running: boolean;
  appliedRevision: number;
  latestRevision: number | null;
  lastCheckedAt: string | null;
  lastAppliedAt: string | null;
  /** Machine-readable, never a raw upstream message. */
  lastError: string | null;
  source: ReturnType<typeof getLlmControlSource>['source'];
}

interface WatcherState {
  status: WatcherStatus;
  timer: ReturnType<typeof setInterval> | null;
  inflight: Promise<WatcherStatus> | null;
  lastReportAt: number;
  lastReported: string;
}

const KEY = Symbol.for('sorye.platform.config.watcher');
const holder = globalThis as typeof globalThis & { [KEY]?: WatcherState };

export function rodrigoConfigured(): boolean {
  return Boolean(process.env.RODRIGO_BASE_URL && process.env.RODRIGO_PRIVATE_KEY_FILE && process.env.RODRIGO_KEY_ID);
}

function instanceId(): string {
  return `${hostname()}-${process.pid}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
}

function pollInterval(): number {
  const raw = Number(process.env.PLATFORM_CONFIG_POLL_MS ?? '15000');
  return Number.isFinite(raw) ? Math.min(300_000, Math.max(2_000, Math.trunc(raw))) : 15_000;
}

function cacheFile(consumer: PlatformConsumer): string {
  const dataDir = process.env.SORYE_DATA_DIR ?? path.join(process.cwd(), '.data');
  return path.join(dataDir, 'platform-config', `${consumer}-${NAMESPACE}.json`);
}

function stateFor(consumer: PlatformConsumer): WatcherState {
  const existing = holder[KEY];
  if (existing) return existing;
  const created: WatcherState = {
    status: {
      consumer,
      instanceId: instanceId(),
      configured: rodrigoConfigured(),
      running: false,
      appliedRevision: 0,
      latestRevision: null,
      lastCheckedAt: null,
      lastAppliedAt: null,
      lastError: null,
      source: getLlmControlSource().source,
    },
    timer: null,
    inflight: null,
    lastReportAt: 0,
    lastReported: '',
  };
  holder[KEY] = created;
  return created;
}

async function writeCache(consumer: PlatformConsumer, revision: number, value: SharedAiConfigV1): Promise<void> {
  const file = cacheFile(consumer);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ revision, value }), 'utf8');
  await rename(tmp, file).catch(async () => writeFile(file, JSON.stringify({ revision, value }), 'utf8'));
}

/** Last-known-good revision so a restart during a Rodrigo outage keeps durable settings. */
async function loadCache(state: WatcherState): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(cacheFile(state.status.consumer), 'utf8')) as { revision?: unknown; value?: unknown };
    const value = sharedAiConfigSchema.parse(raw.value);
    const revision = typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision > 0 ? raw.revision : 0;
    if (!revision) return;
    applyPlatformLlmSettings(value, revision, true);
    state.status.appliedRevision = revision;
    state.status.source = 'platform-cache';
  } catch {
    // No cache yet, or an unreadable one: bootstrap settings stay in effect.
  }
}

async function report(state: WatcherState, revision: number, outcome: 'applied' | 'failed', code?: string): Promise<void> {
  const signature = `${revision}:${outcome}:${code ?? ''}`;
  const now = Date.now();
  if (signature === state.lastReported && now - state.lastReportAt < REPORT_REFRESH_MS) return;
  try {
    await reportPlatformConfigApplied(NAMESPACE, {
      consumer: state.status.consumer,
      instanceId: state.status.instanceId,
      appliedRevision: revision,
      status: outcome,
      ...(code ? { code } : {}),
    });
    state.lastReported = signature;
    state.lastReportAt = now;
  } catch {
    state.status.lastError = 'report_failed';
  }
}

async function tick(state: WatcherState): Promise<WatcherStatus> {
  const status = state.status;
  status.lastCheckedAt = new Date().toISOString();
  try {
    const snapshot = await getPlatformConfig(serviceActor(status.consumer), NAMESPACE);
    status.latestRevision = snapshot.revision;
    status.lastError = null;
    if (snapshot.revision === 0 || !snapshot.value) {
      status.source = getLlmControlSource().source;
      return { ...status };
    }
    if (snapshot.revision !== status.appliedRevision || status.source !== 'platform') {
      try {
        applyPlatformLlmSettings(snapshot.value, snapshot.revision);
      } catch {
        status.lastError = 'invalid_value';
        await report(state, snapshot.revision, 'failed', 'invalid_value');
        return { ...status };
      }
      status.appliedRevision = snapshot.revision;
      status.lastAppliedAt = new Date().toISOString();
      status.source = 'platform';
      logLlmActivity({ type: 'settings_updated', status: 'ok', detail: `Applied shared AI configuration revision ${snapshot.revision}.` });
      await writeCache(status.consumer, snapshot.revision, snapshot.value).catch(() => {
        status.lastError = 'cache_write_failed';
      });
    }
    await report(state, status.appliedRevision, 'applied');
  } catch (error) {
    status.lastError = error instanceof RodrigoResponseError ? error.code.slice(0, 64) : 'rodrigo_unavailable';
  }
  return { ...status };
}

/** Single-flight refresh; callers share an in-progress poll. */
export function refreshPlatformConfig(consumer: PlatformConsumer = 'hub'): Promise<WatcherStatus> {
  const state = stateFor(consumer);
  if (!state.status.configured) return Promise.resolve({ ...state.status });
  if (!state.inflight) {
    state.inflight = tick(state).finally(() => {
      state.inflight = null;
    });
  }
  return state.inflight;
}

export function platformWatcherStatus(): WatcherStatus | null {
  const state = holder[KEY];
  return state ? { ...state.status, source: getLlmControlSource().source } : null;
}

/** Starts polling once per process. Safe to call repeatedly (dev HMR, instrumentation). */
export async function startPlatformConfigWatcher(consumer: PlatformConsumer): Promise<WatcherStatus> {
  const state = stateFor(consumer);
  if (state.timer || !state.status.configured) return { ...state.status };
  await loadCache(state);
  state.status.running = true;
  const first = await refreshPlatformConfig(consumer);
  state.timer = setInterval(() => {
    void refreshPlatformConfig(consumer);
  }, pollInterval());
  state.timer.unref?.();
  return first;
}

export function stopPlatformConfigWatcher(): void {
  const state = holder[KEY];
  if (state?.timer) clearInterval(state.timer);
  if (state) {
    state.timer = null;
    state.status.running = false;
  }
}
