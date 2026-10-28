import { ensureHubUser } from '@/lib/ensure-user';
import { isPlatformAdmin } from '@/lib/platform-admin';
import { initializeLlmControl, setLlmInferencePaused } from '@/lib/llm-control';
import { stopLlmRuntime } from '@/lib/ocr/llm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPlatformAdmin(session.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await initializeLlmControl();
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 1024) return NextResponse.json({ error: 'Action request is too large.' }, { status: 413 });
  const parsed = z.object({ action: z.enum(['pause', 'resume', 'stop']) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choose pause, resume, or stop.' }, { status: 400 });
  if (parsed.data.action === 'resume') {
    await setLlmInferencePaused(false);
    return NextResponse.json({ paused: false, detail: 'LLM requests are enabled.' }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  await setLlmInferencePaused(true);
  if (parsed.data.action === 'stop') {
    const result = await stopLlmRuntime();
    return NextResponse.json({ paused: true, ...result }, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  return NextResponse.json({ paused: true, detail: 'New LLM requests are paused.' }, { headers: { 'Cache-Control': 'private, no-store' } });
}
