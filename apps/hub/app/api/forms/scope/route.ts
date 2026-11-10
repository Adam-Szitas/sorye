import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { deriveActionQueueScope } from '@/lib/rodrigo/queue-scope';

/** Queue scope for the Forms app's durable browser queue. */
export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('forms')) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  const queueScope = deriveActionQueueScope('forms', session.user.id, session.workspace.id);
  return NextResponse.json({ queueScope }, { headers: { 'Cache-Control': 'no-store' } });
}
