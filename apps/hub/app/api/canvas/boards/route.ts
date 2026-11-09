import { ensureHubUser } from '@/lib/ensure-user';
import { canvasAccess, listCanvasBoards, toCanvasSummary } from '@/lib/canvas-rodrigo';
import { sessionWorkspace } from '@/lib/user-load-read';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!canvasAccess(session)) return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  let boards;
  try { boards = await listCanvasBoards({ userId: session.user.id, workspaceId: session.workspace.id }); }
  catch { return NextResponse.json({ error: { code: 'rodrigo_unavailable' } }, { status: 503 }); }

  return NextResponse.json({
    workspace: sessionWorkspace(session),
    user: {
      id: session.user.id,
      displayName: session.user.displayName,
      image: session.user.image,
    },
    boards: boards.map(toCanvasSummary),
  });
}

export async function POST() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!canvasAccess(session)) return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  return NextResponse.json({ error: { code: 'use_rodrigo_action_batch' } }, { status: 405 });
}
