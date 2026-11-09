import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { deriveActionQueueScope } from '@/lib/rodrigo/queue-scope';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!session.workspace.memberIds.includes(session.user.id) || session.workspace.ownerId !== session.user.id) {
    return NextResponse.json({ error: { code: 'operation_forbidden' } }, { status: 403 });
  }
  return NextResponse.json({ queueScope: deriveActionQueueScope('workspace', session.user.id, session.workspace.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
