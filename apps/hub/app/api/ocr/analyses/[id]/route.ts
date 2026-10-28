import { ensureHubUser } from '@/lib/ensure-user';
import { getOcrAnalysis, renameOcrAnalysis } from '@/lib/store/ocr-analyses';
import { emptyPattern, supplementFromRows } from '@/lib/ocr/pattern';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id || id.length > 80) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const result = await getOcrAnalysis(session.user.id, session.workspace.id, id);
  if (result.access === 'denied') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!result.analysis) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const analysis = {
    ...result.analysis,
    pattern: supplementFromRows(result.analysis.pattern ?? emptyPattern(), result.analysis.pages),
  };
  if (new URL(req.url).searchParams.get('view') === 'matrix') {
    const { id: analysisId, fileName, status, pattern, error } = analysis;
    return NextResponse.json(
      { analysis: { id: analysisId, fileName, status, pattern, error } },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  return NextResponse.json({ analysis }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await context.params;
  if (!/^ocr-[a-zA-Z0-9-]{4,40}$/.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON name' }, { status: 400 });
  }
  const raw = body && typeof body === 'object' ? (body as { fileName?: unknown }).fileName : '';
  const fileName = typeof raw === 'string'
    ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180)
    : '';
  if (!fileName) {
    return NextResponse.json({ error: 'A table name is required' }, { status: 400 });
  }
  const analysis = await renameOcrAnalysis(session.user.id, session.workspace.id, id, fileName);
  if (!analysis) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(
    { analysis: { id: analysis.id, fileName: analysis.fileName } },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
