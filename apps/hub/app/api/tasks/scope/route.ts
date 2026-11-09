import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { sessionWorkspace } from '@/lib/user-load-read';
import { deriveActionQueueScope } from '@/lib/rodrigo/queue-scope';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('tasks')) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  const scope = deriveActionQueueScope('tasks', session.user.id, session.workspace.id);
  return NextResponse.json({ queueScope: scope, workspace: sessionWorkspace(session) }, { headers: { 'Cache-Control': 'no-store' } });
}
