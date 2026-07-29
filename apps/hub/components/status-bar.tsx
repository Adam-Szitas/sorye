'use client';

import type { SubscriptionPlan, WorkspaceKind } from '@sorye/types';
import { useEffect, useMemo, useState } from 'react';

interface StatusBarProps {
  plan: SubscriptionPlan;
  selectedCount: number;
  connectionCount: number;
  workspaceKind: WorkspaceKind;
}

export function StatusBar({
  plan,
  selectedCount,
  connectionCount,
  workspaceKind,
}: StatusBarProps) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const time = useMemo(() => {
    if (!now) return '';
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [now]);

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between border-t border-white/5 bg-[var(--color-surface-raised)] px-4 py-1.5 text-[11px] text-[var(--color-text-muted)] sm:px-6">
      <div className="flex items-center gap-3">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: plan.accent }}
          aria-hidden
        />
        <span>{plan.name} plan</span>
        <span aria-hidden>·</span>
        <span>{workspaceKind === 'team' ? 'Team' : 'Personal'}</span>
        <span aria-hidden>·</span>
        <span>
          {selectedCount}/{plan.maxApps === 999 ? '∞' : plan.maxApps} apps
        </span>
        <span aria-hidden>·</span>
        <span>
          {connectionCount}/
          {plan.maxConnections === 999 ? '∞' : plan.maxConnections} connected
        </span>
      </div>
      <time dateTime={now ? now.toISOString() : undefined} suppressHydrationWarning>
        {time}
      </time>
    </footer>
  );
}
