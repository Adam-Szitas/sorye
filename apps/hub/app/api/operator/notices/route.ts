import { ensureHubUser } from '@/lib/ensure-user';
import { operatorDenial } from '@/lib/operator/access';
import {
  createOperatorNotice,
  draftFromBody,
  listOperatorNotices,
  noticeIdFromBody,
  setOperatorNoticeActive,
} from '@/lib/operator/notices';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const session = await ensureHubUser();
  const denied = operatorDenial(session?.user ?? null);
  if (denied || !session) {
    return NextResponse.json(denied?.body ?? { error: 'Unauthorized' }, {
      status: denied?.status ?? 401,
      headers: noStore,
    });
  }
  return NextResponse.json({ notices: await listOperatorNotices() }, { headers: noStore });
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  const denied = operatorDenial(session?.user ?? null);
  if (denied || !session) {
    return NextResponse.json(denied?.body ?? { error: 'Unauthorized' }, {
      status: denied?.status ?? 401,
      headers: noStore,
    });
  }
  const body = await req.json().catch(() => null);
  const id = noticeIdFromBody(body);
  if (id) {
    if (!body || typeof body !== 'object' || typeof (body as { active?: unknown }).active !== 'boolean') {
      return NextResponse.json({ error: 'Invalid notice' }, { status: 400 });
    }
    const updated = await setOperatorNoticeActive(id, (body as { active: boolean }).active);
    if (!updated) return NextResponse.json({ error: 'Notice not found' }, { status: 404 });
    return NextResponse.json({ ok: true, id });
  }
  const draft = draftFromBody(body);
  if (!draft) return NextResponse.json({ error: 'Invalid notice' }, { status: 400 });
  const notice = await createOperatorNotice(draft);
  return NextResponse.json({
    ok: true,
    notice: {
      id: notice.id,
      message: notice.message,
      audience: notice.audience,
      startsAt: notice.startsAt,
      endsAt: notice.endsAt,
      active: notice.active,
    },
  });
}
