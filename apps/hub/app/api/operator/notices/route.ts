import {
  adminAccess,
  adminDenied,
  adminNoStore,
  adminRateLimited,
  adminWriteLimited,
  readAdminJson,
} from '@/lib/admin/access';
import { AdminAuditUnavailableError, auditedAdminAction, type AuditedRun } from '@/lib/admin/audit';
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

type NoticeOutcome = { status: number; body: Record<string, unknown> };

export async function GET() {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  return NextResponse.json({ notices: await listOperatorNotices() }, { headers: adminNoStore });
}

export async function POST(req: Request) {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  if (adminWriteLimited(access.actor.actorId)) return adminRateLimited();
  const body = await readAdminJson(req);
  const id = noticeIdFromBody(body);
  const draft = id ? null : draftFromBody(body);
  const active = body && typeof body === 'object' ? (body as { active?: unknown }).active : undefined;
  if (id ? typeof active !== 'boolean' : !draft) {
    return NextResponse.json({ error: 'Invalid notice' }, { status: 400, headers: adminNoStore });
  }
  try {
    const audited = await auditedAdminAction<NoticeOutcome>(access.actor, id
      ? { action: 'notice.set_active', targetType: 'notice', targetId: id, details: { active: active as boolean } }
      : {
          action: 'notice.create',
          targetType: 'notice',
          targetId: 'new',
          details: { audience: draft!.audience, messageLength: draft!.message.length, active: draft!.active },
        },
    async (): Promise<AuditedRun<NoticeOutcome>> => {
      if (id) {
        const updated = await setOperatorNoticeActive(id, active as boolean);
        if (!updated) return { outcome: 'failed', details: { code: 'notice_not_found' }, result: { status: 404, body: { error: 'Notice not found' } } };
        return { outcome: 'succeeded', result: { status: 200, body: { ok: true, id } } };
      }
      const notice = await createOperatorNotice(draft!);
      return {
        outcome: 'succeeded',
        details: { noticeId: notice.id },
        result: {
          status: 200,
          body: {
            ok: true,
            notice: {
              id: notice.id,
              message: notice.message,
              audience: notice.audience,
              startsAt: notice.startsAt,
              endsAt: notice.endsAt,
              active: notice.active,
            },
          },
        },
      };
    });
    return NextResponse.json(
      { ...audited.result.body, correlationId: audited.correlationId, auditOutcomeRecorded: audited.outcomeRecorded },
      { status: audited.result.status, headers: adminNoStore },
    );
  } catch (error) {
    if (error instanceof AdminAuditUnavailableError) {
      return NextResponse.json({ error: 'audit_unavailable' }, { status: 503, headers: adminNoStore });
    }
    throw error;
  }
}
