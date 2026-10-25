import { ensureHubUser } from '@/lib/ensure-user';
import { parseTasksBoard } from '@/lib/workspace-docs-validate';
import {
  getWorkspaceDoc,
  putWorkspaceDoc,
} from '@/lib/store/workspace-docs';
import { createDefaultTasksBoard } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await getWorkspaceDoc(
    session.user.id,
    session.workspace.id,
    'tasks',
  );
  if (result.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!result.doc) {
    return NextResponse.json({
      board: createDefaultTasksBoard(),
      empty: true,
    });
  }

  try {
    return NextResponse.json({
      board: parseTasksBoard(result.doc.payload.board ?? result.doc.payload),
      empty: false,
    });
  } catch {
    return NextResponse.json({
      board: createDefaultTasksBoard(),
      empty: true,
    });
  }
}

export async function PUT(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    board?: unknown;
    migrate?: boolean;
  };

  let board;
  try {
    board = parseTasksBoard(body.board);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid board' },
      { status: 400 },
    );
  }

  const saved = await putWorkspaceDoc(
    session.user.id,
    session.workspace.id,
    'tasks',
    { board },
    { migrate: body.migrate === true },
  );
  if (!saved) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    return NextResponse.json({
      board: parseTasksBoard(saved.payload.board ?? saved.payload),
      empty: false,
    });
  } catch {
    return NextResponse.json({ board, empty: false });
  }
}
