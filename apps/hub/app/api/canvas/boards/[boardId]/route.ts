import { ensureHubUser } from '@/lib/ensure-user';
import { canvasAccess, readCanvasBoard } from '@/lib/canvas-rodrigo';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ boardId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!canvasAccess(session)) return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });

  const { boardId } = await params;
  let board;
  try { board = await readCanvasBoard({ userId: session.user.id, workspaceId: session.workspace.id }, boardId); }
  catch { return NextResponse.json({ error: { code: 'rodrigo_unavailable' } }, { status: 503 }); }
  if (!board) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(board);
}

export async function PATCH(_req: Request, { params: _params }: Params) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!canvasAccess(session)) return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  return NextResponse.json({ error: { code: 'use_rodrigo_action_batch' } }, { status: 405 });
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!canvasAccess(session)) return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  return NextResponse.json({ error: { code: 'unsupported_operation' } }, { status: 405 });
}
