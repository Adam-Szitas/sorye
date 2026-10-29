import { ensureHubUser } from '@/lib/ensure-user';
import { parseTasksBoard } from '@/lib/workspace-docs-validate';
import {
  getWorkspaceDoc,
  putWorkspaceDoc,
} from '@/lib/store/workspace-docs';
import { createDefaultTasksBoard } from '@sorye/types';
import { NextResponse } from 'next/server';
import { WorkspaceDocConflict } from '@/lib/store/workspace-doc-conflict';
import { WorkspaceDatabaseUnavailableError } from '@/lib/workspace-db';

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
      empty: true, revision: 0,
    });
  }

  try {
    return NextResponse.json({
      board: parseTasksBoard(result.doc.payload.board ?? result.doc.payload),
      empty: false, revision: result.doc.revision,
    });
  } catch {
    return NextResponse.json({
      board: createDefaultTasksBoard(),
      empty: true, revision: 0,
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
    expectedRevision?: number;
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

  let saved;
  try {
    saved = await putWorkspaceDoc(
    session.user.id,
    session.workspace.id,
    'tasks',
    { board },
    { migrate: body.migrate === true, expectedRevision: body.expectedRevision },
  );
  } catch (err) {
    if (err instanceof WorkspaceDocConflict) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof WorkspaceDatabaseUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
  if (!saved) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    return NextResponse.json({
      board: parseTasksBoard(saved.payload.board ?? saved.payload),
      empty: false, revision: saved.revision,
    });
  } catch {
    return NextResponse.json({ board, empty: false, revision: saved.revision });
  }
}
