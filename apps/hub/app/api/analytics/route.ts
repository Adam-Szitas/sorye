import { getWorkspaceAnalytics } from '@/lib/analytics';
import { ensureHubUser } from '@/lib/ensure-user';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const snapshot = await getWorkspaceAnalytics(session.user.id, session.workspace.id);
  if (!snapshot) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
