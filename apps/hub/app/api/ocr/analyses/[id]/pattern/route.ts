import { ensureHubUser } from '@/lib/ensure-user';
import { publishWorkspaceEvent } from '@/lib/events';
import { applyClientWebGpuPattern } from '@/lib/ocr/webgpu-pattern';
import { getOcrAnalysis } from '@/lib/store/ocr-analyses';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await context.params;
  if (!/^ocr-[a-zA-Z0-9-]{4,40}$/.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 4_000_000) {
      return NextResponse.json({ error: 'Pattern payload is too large.' }, { status: 413 });
    }
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'Expected JSON pattern payload.' }, { status: 400 });
  }

  const loaded = await getOcrAnalysis(session.user.id, session.workspace.id, id);
  if (loaded.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!loaded.analysis) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const finished = await applyClientWebGpuPattern(
    session.user.id,
    session.workspace.id,
    loaded.analysis,
    {
      model: typeof record.model === 'string' ? record.model : undefined,
      startedAt: typeof record.startedAt === 'string' ? record.startedAt : undefined,
      durationMs: typeof record.durationMs === 'number' ? record.durationMs : undefined,
      pattern: record.pattern,
    },
  );

  void publishWorkspaceEvent({
    userId: session.user.id,
    workspaceId: session.workspace.id,
    name: 'sorye.ocr.ready',
    payload: {
      title: `WebGPU finished ${finished.fileName}`,
      summary: finished.pattern?.summary || 'Rows normalized on client WebGPU',
      appId: 'ocr',
      entityId: finished.id,
    },
  });

  return NextResponse.json(
    { analysis: finished },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
