import { ensureHubUser } from '@/lib/ensure-user';
import { isPlatformAdmin } from '@/lib/platform-admin';
import { getRodrigoTopology, RodrigoResponseError } from '@/lib/rodrigo/client';
import { NextResponse } from 'next/server';

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  if (!isPlatformAdmin(session.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
  try {
    const data = await getRodrigoTopology({ userId: session.user.id, workspaceId: session.workspace.id });
    return NextResponse.json(data, { headers });
  } catch (error) {
    return NextResponse.json({ error: 'Backend unavailable', code: 'RODRIGO_UNAVAILABLE',
      ...(error instanceof RodrigoResponseError ? { backendCode: error.code, requestId: error.requestId } : {}),
    }, { status: 503, headers });
  }
}
