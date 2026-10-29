import { ensureHubUser } from '@/lib/ensure-user';
import { listOcrAnalyses } from '@/lib/store/ocr-analyses';
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
  if (result.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({ analyses: result.analyses, nextOffset: result.analyses.length === 20 ? offset + 20 : null }, { headers: { 'Cache-Control': 'private, no-store' } });
}
