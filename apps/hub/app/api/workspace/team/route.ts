import { ensureHubUser } from '@/lib/ensure-user';
import {
  createTeamWorkspace,
  switchActiveWorkspace,
} from '@/lib/store';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const hubSession = await ensureHubUser();
  if (!hubSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as
    | { action: 'switch'; workspaceId: string }
    | { action: 'create-team'; name: string };

  if (body.action === 'switch') {
    const updated = await switchActiveWorkspace(
      hubSession.user.id,
      body.workspaceId,
    );
    if (!updated) {
      return NextResponse.json({ error: 'Switch failed' }, { status: 400 });
    }
    return NextResponse.json(updated);
  }

  if (body.action === 'create-team') {
    const updated = await createTeamWorkspace(
      hubSession.user.id,
      body.name,
    );
    if (!updated) {
      return NextResponse.json(
        { error: 'Team creation not allowed on current plan' },
        { status: 403 },
      );
    }
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function GET() {
  const hubSession = await ensureHubUser();
  if (!hubSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(hubSession);
}
