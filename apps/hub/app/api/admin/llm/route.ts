import { adminAccess, adminDenied, adminNoStore } from '@/lib/admin/access';
import { getLlmActivity, getLlmControlSettings, getLlmControlSource, initializeLlmControl } from '@/lib/llm-control';
import { listHostGpus, readGpuSnapshot } from '@/lib/ocr/gpu-guard';
import { assertSafeLlmBaseUrl } from '@/lib/security';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE_TTL_MS = 5_000;
type Probe = { at: number; value: Promise<Record<string, unknown>> };
const PROBE_KEY = Symbol.for('sorye.admin.llm.probe');
const probeHolder = globalThis as typeof globalThis & { [PROBE_KEY]?: Probe };

async function engineStatus(settings: ReturnType<typeof getLlmControlSettings>) {
  if (!settings.baseUrl || !settings.model) return { available: false, detail: 'Configure a provider URL and model.' };
  try {
    const base = assertSafeLlmBaseUrl(settings.baseUrl);
    const url = settings.provider === 'ollama' ? new URL('/api/ps', base) : new URL('/v1/models', base);
    const response = await fetch(url, { signal: AbortSignal.timeout(2500), cache: 'no-store', redirect: 'error' });
    if (!response.ok) return { available: false, detail: `Provider returned HTTP ${response.status}.` };
    const body = await response.text();
    if (Buffer.byteLength(body) > 128_000) return { available: false, detail: 'Provider status response exceeded 128 KB.' };
    const payload = JSON.parse(body) as { models?: unknown[]; data?: unknown[] };
    const loaded = settings.provider === 'ollama' ? payload.models : payload.data;
    return { available: true, loadedModels: Array.isArray(loaded) ? loaded.slice(0, 20) : [] };
  } catch {
    return { available: false, detail: 'Provider is unreachable or returned invalid status.' };
  }
}

async function gpuProcesses() {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    const { stdout } = await promisify(execFile)('nvidia-smi', [
      '--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits',
    ], { timeout: 3000, maxBuffer: 8192, windowsHide: true });
    return stdout.trim().split(/\r?\n/).filter(Boolean).slice(0, 24).map((line) => {
      const [pid, processName, memory] = line.split(',').map((part) => part.trim());
      return { pid: Number(pid), processName: processName ?? 'Unknown process', usedMiB: Number(memory) };
    }).filter((process) => Number.isInteger(process.pid) && Number.isFinite(process.usedMiB));
  } catch {
    return null;
  }
}

/** Coalesced: concurrent admin views share one GPU/provider probe per 5 s. */
function probe(settings: ReturnType<typeof getLlmControlSettings>): Promise<Record<string, unknown>> {
  const cached = probeHolder[PROBE_KEY];
  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.value;
  const value = Promise.all([
    readGpuSnapshot(settings.gpuIndex ?? 0).catch(() => null),
    listHostGpus(),
    gpuProcesses(),
    engineStatus(settings),
  ]).then(([gpu, gpus, processes, engine]) => ({ gpu, gpus, processes, engine }));
  probeHolder[PROBE_KEY] = { at: Date.now(), value };
  return value;
}

/**
 * Read-only runtime telemetry for this Hub process. Configuration writes go
 * through /api/admin/console/config/shared-ai so they are revisioned and audited.
 */
export async function GET() {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  await initializeLlmControl();
  const settings = getLlmControlSettings();
  return NextResponse.json({
    settings,
    source: getLlmControlSource(),
    ...(await probe(settings)),
    events: getLlmActivity(100),
    capturedContent: false,
  }, { headers: adminNoStore });
}
