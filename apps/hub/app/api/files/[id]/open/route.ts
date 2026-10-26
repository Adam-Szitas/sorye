import { ensureHubUser } from '@/lib/ensure-user';
import { FileAccessError } from '@/lib/files';
import { relayFileToApp } from '@/lib/relay';
import { APP_CATALOG } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const app = APP_CATALOG.find((entry) => entry.id === body.targetAppId);
  if (!app || (!app.alwaysAvailable && !session.workspace.selectedAppIds.includes(app.id)) ||
      (app.adminOnly && !session.user.isAdmin)) {
    return NextResponse.json({ error: 'Add this app to your workspace before opening the file' }, { status: 403 });
  }
  try {
    const { id } = await context.params;
    const handoff = await relayFileToApp(session.workspace.id, id, app.id);
    return NextResponse.json({ handoff, href: `${app.mountPath}?handoff=${encodeURIComponent(handoff.id)}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not open file' },
      { status: err instanceof FileAccessError ? err.status : 500 });
  }
}
