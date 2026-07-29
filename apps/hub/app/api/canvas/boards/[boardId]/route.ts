import { ensureHubUser } from '@/lib/ensure-user';
import {
  publishBoardEvent,
} from '@/lib/canvas-realtime';
import {
  deleteCanvasBoard,
  getCanvasBoard,
  updateCanvasBoard,
} from '@/lib/store/canvas';
import type { CanvasDocument } from '@sorye/types';
import { NextResponse } from 'next/server';

type Params = { params: Promise<{ boardId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { boardId } = await params;
  const board = await getCanvasBoard(
    session.user.id,
    session.workspace.id,
    boardId,
  );
  if (!board) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(board);
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { boardId } = await params;
  const body = (await req.json()) as {
    title?: string;
    document?: CanvasDocument;
    expectedRevision?: number;
  };

  const result = await updateCanvasBoard(
    session.user.id,
    session.workspace.id,
    boardId,
    body,
  );

  if (!result) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if ('conflict' in result) {
    return NextResponse.json(
      { error: 'Conflict', board: result.conflict },
      { status: 409 },
    );
  }

  publishBoardEvent(boardId, {
    type: 'board-updated',
    board: result.board,
    byUserId: session.user.id,
  });

  return NextResponse.json(result.board);
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { boardId } = await params;
  const ok = await deleteCanvasBoard(
    session.user.id,
    session.workspace.id,
    boardId,
  );
  if (!ok) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  publishBoardEvent(boardId, {
    type: 'board-deleted',
    boardId,
    byUserId: session.user.id,
  });

  return NextResponse.json({ ok: true });
}
