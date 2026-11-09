import { ensureHubUser } from '@/lib/ensure-user';
import { acknowledgeOcrJob, latestRelevantOcrJob, ocrResumeSummary } from '@/lib/jobs';
import { NextResponse } from 'next/server';

const noStore = { 'Cache-Control': 'private, no-store' };

/** Latest OCR job for the signed-in user in the session workspace. No client workspace id. */
export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const job = await latestRelevantOcrJob(session.workspace.id, session.user.id);
  return NextResponse.json({ job: ocrResumeSummary(job) }, { headers: noStore });
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { jobId?: unknown } | null;
  const jobId = body?.jobId;
  if (typeof jobId !== 'string' || !jobId.trim() || jobId.length > 128) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  const ok = await acknowledgeOcrJob(session.workspace.id, session.user.id, jobId.trim());
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
