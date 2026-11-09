import { ensureHubUser } from '@/lib/ensure-user';
import { listOcrAnalyses } from '@/lib/store/ocr-analyses';
import { readPartitionedLoad, sessionWorkspace } from '@/lib/user-load-read';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const offset = Number(new URL(req.url).searchParams.get('offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    return NextResponse.json({ error: 'Invalid offset' }, { status: 400 });
  }
  const result = await listOcrAnalyses(session.user.id, session.workspace.id, offset);
  const load = offset === 0
    ? await readPartitionedLoad(session, async (scope) => {
      const listed = await listOcrAnalyses(session.user.id, scope.id, 0);
      if (listed.access === 'denied') return [];
      return listed.analyses.map((analysis) => ({ workspaceId: scope.id, value: analysis }));
    }, { appId: 'ocr' })
    : undefined;
  if (result.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({
    analyses: result.analyses,
    nextOffset: result.analyses.length === 20 ? offset + 20 : null,
    load,
    workspace: sessionWorkspace(session),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
