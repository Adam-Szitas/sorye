import { ensureHubUser } from '@/lib/ensure-user';
import { cancelJob, getJob } from '@/lib/jobs';
import { NextResponse } from 'next/server';

type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Context) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const job = await getJob(session.workspace.id, (await ctx.params).id);
  if (!job || job.userId !== session.user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ id: job.id, status: job.status, attempts: job.attempts,
    result: job.result, error: job.error }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function DELETE(_req: Request, ctx: Context) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = (await ctx.params).id;
  const job = await getJob(session.workspace.id, id);
  if (!job || job.userId !== session.user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await cancelJob(session.workspace.id, id);
  return NextResponse.json({ ok: true });
}
