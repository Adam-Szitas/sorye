import { ensureHubUser } from '@/lib/ensure-user';
import { getUserGpuPreference, initializeLlmControl } from '@/lib/llm-control';
import { listMcpToolsForSession } from '@/lib/mcp/tools';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await initializeLlmControl();
  const tools = listMcpToolsForSession(session);
  const gpuPreference = getUserGpuPreference(session.user.id);
  return NextResponse.json(
    {
      tools,
      gpuPreference,
      workspace: {
        id: session.workspace.id,
        name: session.workspace.name,
        selectedAppIds: session.workspace.selectedAppIds,
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
