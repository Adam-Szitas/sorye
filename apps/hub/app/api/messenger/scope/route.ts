import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { deriveActionQueueScope } from '@/lib/rodrigo/queue-scope';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('messenger')) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  return NextResponse.json({ queueScope: deriveActionQueueScope('messenger', session.user.id, session.workspace.id) }, { headers: { 'Cache-Control': 'no-store' } });
}
