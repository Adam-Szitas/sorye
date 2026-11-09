import type { OperatorNoticeAudience, OperatorNoticeRecord } from '@sorye/types';
import { SUBSCRIPTION_PLANS, type SubscriptionTierId } from '@sorye/types';

const AUDIENCES = new Set<OperatorNoticeAudience>([
  'all',
  ...SUBSCRIPTION_PLANS.map((plan) => plan.id),
]);

export interface NoticeVisibility {
  plan: SubscriptionTierId;
  now: number;
  dismissed: boolean;
}

/** True only for an active notice in its window for this plan. */
export function noticeVisibleTo(
  notice: Pick<OperatorNoticeRecord, 'active' | 'audience' | 'startsAt' | 'endsAt'>,
  viewer: NoticeVisibility,
): boolean {
  if (!notice.active || viewer.dismissed) return false;
  if (notice.audience !== 'all' && notice.audience !== viewer.plan) return false;
  if (notice.startsAt) {
    const start = Date.parse(notice.startsAt);
    if (!Number.isFinite(start) || start > viewer.now) return false;
  }
  if (notice.endsAt) {
    const end = Date.parse(notice.endsAt);
    if (!Number.isFinite(end) || end < viewer.now) return false;
  }
  return true;
}

function cleanText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export interface NoticeDraft {
  message: string;
  audience: OperatorNoticeAudience;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
}

export function parseNoticeDraft(input: unknown): NoticeDraft | null {
  if (!input || typeof input !== 'object') return null;
  const body = input as Record<string, unknown>;
  if (typeof body.message !== 'string') return null;
  const message = cleanText(body.message, 400);
  if (!message) return null;
  if (typeof body.audience !== 'string' || !AUDIENCES.has(body.audience as OperatorNoticeAudience)) {
    return null;
  }
  const startsAt = parseOptionalTime(body.startsAt);
  const endsAt = parseOptionalTime(body.endsAt);
  if (startsAt === undefined || endsAt === undefined) return null;
  if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) return null;
  return {
    message,
    audience: body.audience as OperatorNoticeAudience,
    startsAt,
    endsAt,
    active: body.active !== false,
  };
}

function parseOptionalTime(value: unknown): string | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 40) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

export function parseNoticeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!/^ntc-[a-z0-9-]{8,40}$/.test(value)) return null;
  return value;
}
