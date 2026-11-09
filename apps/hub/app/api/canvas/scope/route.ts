import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { canvasAccess } from '@/lib/canvas-rodrigo';
import { deriveActionQueueScope } from '@/lib/rodrigo/queue-scope';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!canvasAccess(session)) return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  const queueScope = deriveActionQueueScope('canvas', session.user.id, session.workspace.id);
  return NextResponse.json({ queueScope }, { headers: { 'Cache-Control': 'no-store' } });
}
