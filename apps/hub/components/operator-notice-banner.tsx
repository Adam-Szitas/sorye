'use client';

import type { OperatorNoticeMessage } from '@sorye/types';
import { useCallback, useEffect, useState } from 'react';

export function OperatorNoticeBanner() {
  const [notices, setNotices] = useState<OperatorNoticeMessage[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notices', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) {
        setNotices([]);
        return;
      }
      const body = (await res.json()) as { notices?: OperatorNoticeMessage[] };
      setNotices(Array.isArray(body.notices) ? body.notices : []);
    } catch {
      setNotices([]);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  async function dismiss(id: string) {
    const res = await fetch('/api/notices', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss', id }),
    });
    if (!res.ok) return;
    const body = (await res.json()) as { notices?: OperatorNoticeMessage[] };
    setNotices(Array.isArray(body.notices) ? body.notices : []);
  }

  if (notices.length === 0) return null;

  return (
    <div className="flex justify-center px-4 pt-3 sm:px-8" role="region" aria-label="Notices">
      <ul className="flex w-full max-w-6xl flex-col gap-2">
        {notices.map((notice) => (
          <li key={notice.id} className="flex items-start justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3 text-sm">
            <p>{notice.message}</p>
            <button
              type="button"
              className="shrink-0 rounded-lg px-3 py-2"
              onClick={() => void dismiss(notice.id)}
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
