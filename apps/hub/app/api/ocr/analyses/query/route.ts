import { ensureHubUser } from '@/lib/ensure-user';
import { parseLibraryQuery } from '@/lib/ocr/library-query';
import { queryOcrLibrary } from '@/lib/store/ocr-analyses';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 20_000) {
      return NextResponse.json({ error: 'Search is too large' }, { status: 400 });
    }
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'Expected a JSON search' }, { status: 400 });
  }

  let query;
  try {
    query = parseLibraryQuery(body);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Search is not valid' },
      { status: 400 },
    );
  }

  const result = await queryOcrLibrary(session.user.id, session.workspace.id, query);
  if (result.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(
    { hits: result.hits },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
