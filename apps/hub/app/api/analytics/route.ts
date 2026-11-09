import { getWorkspaceAnalytics } from '@/lib/analytics';
import { ensureHubUser } from '@/lib/ensure-user';
import { readPartitionedLoad, sessionWorkspace } from '@/lib/user-load-read';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const snapshot = await getWorkspaceAnalytics(session.user.id, session.workspace.id);
  const load = await readPartitionedLoad(session, async (scope) => {
    const side = await getWorkspaceAnalytics(session.user.id, scope.id);
    if (!side) return [];
    return [{ workspaceId: scope.id, value: side }];
  }, { appId: 'dashboard' });
  if (!snapshot && load.personal.length + load.work.length === 0) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    sections: snapshot?.sections ?? [],
    load,
    workspace: sessionWorkspace(session),
  }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
