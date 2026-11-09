import { ensureHubUser } from '@/lib/ensure-user';
import { dismissOperatorNotice, noticesForUser } from '@/lib/operator/notices';
import { parseNoticeId } from '@/lib/operator/notices-match';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  }
  const notices = await noticesForUser({
    userId: session.user.id,
    plan: session.workspace.subscriptionId,
  });
  return NextResponse.json({ notices }, { headers: noStore });
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  }
  const body = await req.json().catch(() => null);
  const id = body && typeof body === 'object' ? parseNoticeId((body as { id?: unknown }).id) : null;
  if (!id || (body as { action?: unknown }).action !== 'dismiss') {
    return NextResponse.json({ error: 'Invalid notice' }, { status: 400 });
  }
  await dismissOperatorNotice(session.user.id, id);
  const notices = await noticesForUser({
    userId: session.user.id,
    plan: session.workspace.subscriptionId,
  });
  return NextResponse.json({ notices }, { headers: noStore });
}
