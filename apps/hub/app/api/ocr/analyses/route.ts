import { ensureHubUser } from '@/lib/ensure-user';
import { listOcrAnalyses } from '@/lib/store/ocr-analyses';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await listOcrAnalyses(session.user.id, session.workspace.id);
  if (result.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({ analyses: result.analyses }, { headers: { 'Cache-Control': 'private, no-store' } });
}
