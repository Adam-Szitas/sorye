import { ensureHubUser } from '@/lib/ensure-user';
import { getRodrigoCapabilities } from '@/lib/rodrigo/client';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const data = await getRodrigoCapabilities({ userId: session.user.id, workspaceId: session.workspace.id });
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Backend unavailable', code: 'RODRIGO_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
