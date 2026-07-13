import { ensureHubUser } from '@/lib/ensure-user';
import { updateWorkspace } from '@/lib/store';
import type { ConnectedApp } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const hubSession = await ensureHubUser();
  if (!hubSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(hubSession);
}

export async function PATCH(req: Request) {
  const hubSession = await ensureHubUser();
  if (!hubSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as {
    selectedAppIds?: string[];
    connectedApps?: ConnectedApp[];
    name?: string;
  };

  const updated = await updateWorkspace(
    hubSession.user.id,
    hubSession.workspace.id,
    body,
  );

  if (!updated) {
    return NextResponse.json({ error: 'Update failed' }, { status: 400 });
  }

  return NextResponse.json(updated);
}
