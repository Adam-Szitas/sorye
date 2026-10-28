import { ensureHubUser } from '@/lib/ensure-user';
import { isPlatformAdmin } from '@/lib/platform-admin';
import { getLlmActivity, getLlmControlSettings, initializeLlmControl, logLlmActivity, saveLlmControlSettings } from '@/lib/llm-control';
import { readGpuSnapshot } from '@/lib/ocr/gpu-guard';
import { assertSafeLlmBaseUrl } from '@/lib/security';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const settingsSchema = z.object({
  provider: z.enum(['ollama', 'vllm']),
  baseUrl: z.string().max(240),
  model: z.string().max(80),
  contextLength: z.number().int().min(2048).max(8192),
  maxOutputTokens: z.number().int().min(128).max(1800),
  minFreeVramMiB: z.number().int().min(512).max(8192),
});

async function authorizedAdmin() {
  const session = await ensureHubUser();
  if (!session) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!isPlatformAdmin(session.user)) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { session };
}

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

export async function GET() {
  const auth = await authorizedAdmin();
  if ('response' in auth) return auth.response;
  await initializeLlmControl();
  const settings = getLlmControlSettings();
  const [gpu, processes, engine] = await Promise.all([
    readGpuSnapshot().catch(() => null), gpuProcesses(), engineStatus(settings),
  ]);
  return NextResponse.json({
    settings,
    gpu,
    processes,
    engine,
    events: getLlmActivity(100),
    capturedContent: false,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PATCH(req: Request) {
  const auth = await authorizedAdmin();
  if ('response' in auth) return auth.response;
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 8192) {
    return NextResponse.json({ error: 'Settings request is too large.' }, { status: 413 });
  }
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON settings.' }, { status: 400 }); }
  await initializeLlmControl();
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings.' }, { status: 400 });
  try {
    if (parsed.data.baseUrl) assertSafeLlmBaseUrl(parsed.data.baseUrl);
    const current = getLlmControlSettings();
    const settings = await saveLlmControlSettings({ ...parsed.data, paused: current.paused });
    logLlmActivity({ type: 'settings_updated', provider: settings.provider, model: settings.model, status: 'ok', detail: 'LLM runtime settings updated by a platform administrator.' });
    return NextResponse.json({ settings }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not save settings.' }, { status: 400 });
  }
}
