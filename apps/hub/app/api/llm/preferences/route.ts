import { ensureHubUser } from '@/lib/ensure-user';
import {
  getLlmControlSettings,
  getUserGpuPreference,
  initializeLlmControl,
  saveUserGpuPreference,
} from '@/lib/llm-control';
import { listHostGpus, readGpuSnapshot } from '@/lib/ocr/gpu-guard';
import { WEBGPU_MODEL_CATALOG } from '@sorye/types';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await initializeLlmControl();
  const preference = getUserGpuPreference(session.user.id);
  const serverSettings = getLlmControlSettings();
  const [hostGpus, activeHostGpu] = await Promise.all([
    listHostGpus(),
    readGpuSnapshot(preference.hostGpuIndex).catch(() => null),
  ]);

  return NextResponse.json(
    {
      preference,
      hostGpus,
      activeHostGpu,
      webGpuCatalog: WEBGPU_MODEL_CATALOG,
      serverEngine: {
        provider: serverSettings.provider,
        model: serverSettings.model || 'Qwen/Qwen3-8B',
        gpuIndex: serverSettings.gpuIndex ?? 0,
        paused: serverSettings.paused,
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function PATCH(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return NextResponse.json({ error: 'Preference payload is too large.' }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON preference.' }, { status: 400 });
  }
  try {
    const current = getUserGpuPreference(session.user.id);
    const merged = body && typeof body === 'object' ? { ...current, ...(body as Record<string, unknown>) } : current;
    const preference = await saveUserGpuPreference(session.user.id, merged);
    return NextResponse.json(
      { preference },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not save GPU preference.' },
      { status: 400 },
    );
  }
}
