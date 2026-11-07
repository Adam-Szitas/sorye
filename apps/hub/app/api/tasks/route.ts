import { ensureHubUser } from '@/lib/ensure-user';
import { parseTasksBoard } from '@/lib/workspace-docs-validate';
import {
  getWorkspaceDoc,
  putWorkspaceDoc,
} from '@/lib/store/workspace-docs';
import { createDefaultTasksBoard } from '@sorye/types';
import { NextResponse } from 'next/server';
import { documentRouteError } from '@/lib/document-route-error';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let result;
  try {
    result = await getWorkspaceDoc(session.user.id, session.workspace.id, 'tasks', session);
  } catch (error) {
    return documentRouteError(error);
  }
  if (result.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!result.doc) {
    return NextResponse.json({
      board: createDefaultTasksBoard(),
      empty: true, revision: result.revision ?? 0,
    });
  }

  try {
    return NextResponse.json({
      board: parseTasksBoard(result.doc.payload.board ?? result.doc.payload),
      empty: false, revision: result.doc.revision,
    });
  } catch {
    return NextResponse.json({ error: 'Stored document is invalid. Contact an administrator.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
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
      session,
    );
  } catch (err) {
    return documentRouteError(err);
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
    return NextResponse.json({ error: 'Stored document is invalid. Contact an administrator.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
