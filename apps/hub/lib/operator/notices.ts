import { randomUUID } from 'crypto';
import type { OperatorNoticeMessage, OperatorNoticeRecord, SubscriptionTierId } from '@sorye/types';
import { jsonDataFile } from '@/lib/store/json-file';
import {
  noticeVisibleTo,
  parseNoticeDraft,
  parseNoticeId,
  type NoticeDraft,
} from '@/lib/operator/notices-match';

const MAX_NOTICES = 40;

interface NoticeStore {
  notices: OperatorNoticeRecord[];
}

interface DismissalStore {
  [userId: string]: string[];
}

const noticesFile = jsonDataFile<NoticeStore>('operator-notices.json', () => ({ notices: [] }));
const dismissalsFile = jsonDataFile<DismissalStore>('operator-dismissals.json', () => ({}));

export async function listOperatorNotices(): Promise<OperatorNoticeRecord[]> {
  const store = await noticesFile.read();
  return store.notices.slice();
}

export async function createOperatorNotice(draft: NoticeDraft): Promise<OperatorNoticeRecord> {
  const notice: OperatorNoticeRecord = {
    id: `ntc-${randomUUID().slice(0, 12)}`,
    message: draft.message,
    audience: draft.audience,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    active: draft.active,
    createdAt: new Date().toISOString(),
  };
  await noticesFile.update((store) => {
    store.notices.push(notice);
    if (store.notices.length > MAX_NOTICES) {
      store.notices.splice(0, store.notices.length - MAX_NOTICES);
    }
  });
  return notice;
}

export async function setOperatorNoticeActive(id: string, active: boolean): Promise<boolean> {
  let found = false;
  await noticesFile.update((store) => {
    const notice = store.notices.find((item) => item.id === id);
    if (!notice) return;
    notice.active = active;
    found = true;
  });
  return found;
}

export async function noticesForUser(input: {
  userId: string;
  plan: SubscriptionTierId;
  now?: number;
}): Promise<OperatorNoticeMessage[]> {
  const now = input.now ?? Date.now();
  const [store, dismissals] = await Promise.all([
    noticesFile.read(),
    dismissalsFile.read(),
  ]);
  const dismissed = new Set(dismissals[input.userId] ?? []);
  return store.notices
    .filter((notice) => noticeVisibleTo(notice, {
      plan: input.plan,
      now,
      dismissed: dismissed.has(notice.id),
    }))
    .map((notice) => ({ id: notice.id, message: notice.message }));
}

export async function dismissOperatorNotice(userId: string, id: string): Promise<void> {
  await dismissalsFile.update((store) => {
    const current = new Set(store[userId] ?? []);
    current.add(id);
    store[userId] = [...current].slice(-80);
  });
}

export function draftFromBody(input: unknown): NoticeDraft | null {
  return parseNoticeDraft(input);
}

export function noticeIdFromBody(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  return parseNoticeId((input as { id?: unknown }).id);
}
