import { ensureHubUser } from '@/lib/ensure-user';
import { parseNotes } from '@/lib/workspace-docs-validate';
import {
  getWorkspaceDoc,
  putWorkspaceDoc,
} from '@/lib/store/workspace-docs';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await getWorkspaceDoc(
    session.user.id,
    session.workspace.id,
    'notes',
  );
  if (result.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!result.doc) {
    return NextResponse.json({ notes: [], empty: true });
  }

  try {
    return NextResponse.json({
      notes: parseNotes(result.doc.payload.notes ?? result.doc.payload),
      empty: false,
    });
  } catch {
    return NextResponse.json({ notes: [], empty: true });
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

  const saved = await putWorkspaceDoc(
    session.user.id,
    session.workspace.id,
    'notes',
    { notes },
    { migrate: body.migrate === true },
  );
  if (!saved) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    return NextResponse.json({
      notes: parseNotes(saved.payload.notes ?? saved.payload),
      empty: false,
    });
  } catch {
    return NextResponse.json({ notes, empty: false });
  }
}
