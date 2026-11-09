import { ensureHubUser } from '@/lib/ensure-user';
import { getUserGpuPreference, initializeLlmControl } from '@/lib/llm-control';
import { answerMcpChat } from '@/lib/mcp/tools';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 16_384) {
      return NextResponse.json({ error: 'Prompt is too large.' }, { status: 413 });
    }
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'Expected JSON chat body.' }, { status: 400 });
  }

  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim().slice(0, 4000) : '';
  const activeAppId = typeof record.activeAppId === 'string' ? record.activeAppId.trim() : null;

  if (!prompt) {
    return NextResponse.json({ error: 'A prompt is required.' }, { status: 400 });
  }

  const started = Date.now();
  await initializeLlmControl();
  const gpuPreference = getUserGpuPreference(session.user.id);
  const { reply, traces, actions, engine, model } = await answerMcpChat(session, prompt, {
    activeAppId,
  });

  return NextResponse.json(
    {
      reply,
      traces,
      actions,
      executionTarget: gpuPreference.target,
      engine,
      model: engine === 'server-llm' ? model : engine === 'built-in' ? 'built-in' : 'Sorye MCP tools',
      durationMs: Math.max(1, Date.now() - started),
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
