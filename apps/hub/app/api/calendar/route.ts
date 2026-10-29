import { ensureHubUser } from '@/lib/ensure-user';
import { parseCalendarEvents } from '@/lib/workspace-docs-validate';
import {
  getWorkspaceDoc,
  putWorkspaceDoc,
} from '@/lib/store/workspace-docs';
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
    'calendar',
  );
  if (result.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!result.doc) {
    return NextResponse.json({ events: [], empty: true, revision: 0 });
  }

  try {
    return NextResponse.json({
      events: parseCalendarEvents(
        result.doc.payload.events ?? result.doc.payload,
      ),
      empty: false, revision: result.doc.revision,
    });
  } catch {
    return NextResponse.json({ events: [], empty: true, revision: 0 });
  }
}

export async function PUT(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    events?: unknown;
    migrate?: boolean;
    expectedRevision?: number;
  };

  let events;
  try {
    events = parseCalendarEvents(body.events);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid events' },
      { status: 400 },
    );
  }

  let saved;
  try {
    saved = await putWorkspaceDoc(
    session.user.id,
    session.workspace.id,
    'calendar',
    { events },
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
      events: parseCalendarEvents(saved.payload.events ?? saved.payload),
      empty: false, revision: saved.revision,
    });
  } catch {
    return NextResponse.json({ events, empty: false, revision: saved.revision });
  }
}
