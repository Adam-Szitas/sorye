import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { listRodrigoResources, RodrigoResponseError } from '@/lib/rodrigo/service-client';

export async function GET(req: Request) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('calendar')) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? 100);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== undefined && cursor.length > 160)) {
    return NextResponse.json({ error: { code: 'invalid_collection_page' } }, { status: 400 });
  }
  try {
    const page = await listRodrigoResources({ userId: session.user.id, workspaceId: session.workspace.id }, 'calendar', 'event', limit, cursor);
    return NextResponse.json(page, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof RodrigoResponseError ? error.status : 503;
    const code = error instanceof RodrigoResponseError ? error.code : 'rodrigo_unavailable';
    const requestId = error instanceof RodrigoResponseError ? error.requestId : undefined;
    return NextResponse.json({ error: { code, ...(requestId ? { requestId } : {}) } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

/** Legacy document writes are disabled after the Rodrigo v2 cutover. */
export async function PUT() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  return NextResponse.json({ error: { code: 'legacy_writer_disabled', owner: 'rodrigo_v2' } }, { status: 410 });
}
