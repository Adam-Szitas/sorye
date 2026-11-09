import type { OperatorHealthSnapshot } from '@sorye/types';

const TTL_MS = 8_000;

let cached: { at: number; value: OperatorHealthSnapshot } | null = null;
let inflight: Promise<OperatorHealthSnapshot> | null = null;

function downHealth(stale: boolean): OperatorHealthSnapshot {
  return {
    hub: 'up',
    database: 'down',
    rodrigo: 'down',
    ocrWorker: 'down',
    llm: 'unknown',
    gpu: null,
    checkedAt: new Date().toISOString(),
    stale,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function within<T>(task: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probe(input: { userId: string; workspaceId: string }): Promise<OperatorHealthSnapshot> {
  const [database, rodrigo, ocrWorker, llm, gpu] = await Promise.all([
    within(databaseStatus(), 1_500, 'down' as const),
    within(rodrigoStatus(input), 2_000, 'down' as const),
    within(workerStatus(), 1_500, 'down' as const),
    within(llmStatus(), 2_000, 'unknown' as const),
    within(gpuStatus(), 3_500, null),
  ]);
  return {
    hub: 'up',
    database,
    rodrigo,
    ocrWorker,
    llm,
    gpu,
    checkedAt: new Date().toISOString(),
    stale: false,
  };
}

async function databaseStatus(): Promise<'up' | 'down'> {
  const { getDb, isDatabaseConfigured } = await import('@sorye/db');
  if (!isDatabaseConfigured()) return 'down';
  const { sql } = await import('drizzle-orm');
  await getDb().execute(sql`select 1`);
  return 'up';
}

async function rodrigoStatus(input: {
  userId: string;
  workspaceId: string;
}): Promise<'up' | 'down' | 'unconfigured'> {
  if (!process.env.RODRIGO_BASE_URL || !process.env.RODRIGO_PRIVATE_KEY_FILE || !process.env.RODRIGO_KEY_ID) {
    return 'unconfigured';
  }
  const { getRodrigoTopology } = await import('@/lib/rodrigo/service-client');
  await getRodrigoTopology({ userId: input.userId, workspaceId: input.workspaceId });
  return 'up';
}

async function workerStatus(): Promise<'up' | 'down'> {
  const { hasLiveWorker } = await import('@/lib/jobs');
  return (await hasLiveWorker('ocr')) ? 'up' : 'down';
}

async function llmStatus(): Promise<OperatorHealthSnapshot['llm']> {
  const { getLlmControlSettings, initializeLlmControl } = await import('@/lib/llm-control');
  await initializeLlmControl();
  const settings = getLlmControlSettings();
  if (settings.paused) return 'paused';
  if (!settings.baseUrl || !settings.model) return 'unknown';
  const { assertSafeLlmBaseUrl } = await import('@/lib/security');
  const base = assertSafeLlmBaseUrl(settings.baseUrl);
  const url = settings.provider === 'ollama' ? new URL('/api/ps', base) : new URL('/v1/models', base);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(1_500),
    cache: 'no-store',
    redirect: 'error',
  });
  return response.ok ? 'available' : 'unavailable';
}

async function gpuStatus(): Promise<OperatorHealthSnapshot['gpu']> {
  const { listHostGpus } = await import('@/lib/ocr/gpu-guard');
  const [gpu] = await listHostGpus();
  if (!gpu) return null;
  return { name: gpu.name, freeMiB: gpu.freeMiB, totalMiB: gpu.totalMiB };
}

/**
 * Cached for a few seconds and single-flight so a dashboard refresh does not
 * stampede the database, Rodrigo, or nvidia-smi. Call only from the operator page.
 */
export async function readOperatorHealth(input: {
  userId: string;
  workspaceId: string;
}): Promise<OperatorHealthSnapshot> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { ...cached.value, stale: false };
  }
  if (!inflight) {
    inflight = probe(input)
      .then((value) => {
        cached = { at: Date.now(), value };
        return value;
      })
      .catch(() => downHealth(false))
      .finally(() => {
        inflight = null;
      });
  }
  const pending = inflight;
  if (cached) {
    const fresh = await Promise.race([
      pending.then((value) => value),
      delay(1_500).then(() => null),
    ]);
    if (fresh) return { ...fresh, stale: false };
    return { ...cached.value, stale: true };
  }
  return pending;
}
