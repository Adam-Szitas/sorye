import { ensureHubUser } from '@/lib/ensure-user';
import { parseNotes } from '@/lib/workspace-docs-validate';
import {
  getWorkspaceDoc,
  putWorkspaceDoc,
} from '@/lib/store/workspace-docs';
import { NextResponse } from 'next/server';
import { documentRouteError } from '@/lib/document-route-error';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let result;
  try {
    result = await getWorkspaceDoc(session.user.id, session.workspace.id, 'notes', session);
  } catch (error) {
    return documentRouteError(error);
  }
  if (result.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!result.doc) {
    return NextResponse.json({ notes: [], empty: true, revision: result.revision ?? 0 });
  }

  try {
    return NextResponse.json({
      notes: parseNotes(result.doc.payload.notes ?? result.doc.payload),
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
    notes?: unknown;
    migrate?: boolean;
    expectedRevision?: number;
  };

  let notes;
  try {
    notes = parseNotes(body.notes);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid notes' },
      { status: 400 },
    );
  }

  let saved;
  try {
    saved = await putWorkspaceDoc(
      session.user.id,
      session.workspace.id,
      'notes',
      { notes },
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
      notes: parseNotes(saved.payload.notes ?? saved.payload),
      empty: false, revision: saved.revision,
    });
  } catch {
    return NextResponse.json({ error: 'Stored document is invalid. Contact an administrator.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
