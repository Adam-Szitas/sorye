import { ensureHubUser } from '@/lib/ensure-user';
import {
  createCanvasBoard,
  listCanvasBoards,
} from '@/lib/store/canvas';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const boards = await listCanvasBoards(
    session.user.id,
    session.workspace.id,
  );
  if (!boards) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    workspace: {
      id: session.workspace.id,
      kind: session.workspace.kind,
      name: session.workspace.name,
    },
    user: {
      id: session.user.id,
      displayName: session.user.displayName,
      image: session.user.image,
    },
    boards,
  });
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const board = await createCanvasBoard(
    session.user.id,
    session.workspace.id,
    body.title ?? 'Untitled board',
  );

  if (!board) {
    return NextResponse.json({ error: 'Create failed' }, { status: 403 });
  }

  return NextResponse.json(board, { status: 201 });
}
