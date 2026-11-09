import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { deriveActionQueueScope } from '@/lib/rodrigo/queue-scope';
import { sessionWorkspace } from '@/lib/user-load-read';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('site')) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  return NextResponse.json({ queueScope: deriveActionQueueScope('site', session.user.id, session.workspace.id), workspace: sessionWorkspace(session) }, { headers: { 'Cache-Control': 'no-store' } });
}
