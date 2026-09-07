import type { HubUser, SubscriptionPlan, Workspace } from '@sorye/types';
import Link from 'next/link';
import { SubscriptionBadge } from './subscription-badge';

interface TopBarProps {
  user: HubUser;
  workspace: Workspace;
  plan: SubscriptionPlan;
  notificationCount?: number;
  onOpenNotifications: () => void;
  onOpenContact: () => void;
  onOpenPicker: () => void;
  onOpenConnections: () => void;
  onSignOut: () => void;
}

export function TopBar({
  user,
  workspace,
  plan,
  notificationCount = 0,
  onOpenNotifications,
  onOpenContact,
  onOpenPicker,
  onOpenConnections,
  onSignOut,
}: TopBarProps) {
  return (
    <header className="glass sticky top-0 z-40 flex items-center justify-between px-4 py-3 sm:px-8">
      <div className="flex items-center gap-3">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg font-bold text-[var(--color-surface)]"
          style={{ background: plan.accent }}
          aria-hidden
        >
          S
        </div>
        <div>
          <p className="text-sm font-semibold leading-none">Sorye</p>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            {workspace.kind === 'team' ? `${workspace.name} · Team` : 'Hub OS'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <button
          type="button"
          onClick={onOpenNotifications}
          className="relative rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
          aria-label={
            notificationCount > 0
              ? `Notifications, ${notificationCount} unread`
              : 'Notifications'
          }
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            aria-hidden
          >
            <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .53-.21 1.04-.59 1.4L4 17h5" />
            <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
          </svg>
          {notificationCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onOpenContact}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition hover:bg-white/10"
        >
          Contact
        </button>
        <button
          type="button"
          onClick={onOpenPicker}
          className="hidden rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)] sm:block"
        >
          Manage apps
        </button>
        <button
          type="button"
          onClick={onOpenConnections}
          className="hidden rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)] sm:block"
        >
          Connections
        </button>
        <SubscriptionBadge plan={plan} />
        {user.isAdmin ? (
          <span className="hidden rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300 sm:inline">
            Admin
          </span>
        ) : null}
        {process.env.NODE_ENV === 'development' && user.isAdmin ? (
          <Link
            href="/dev"
            className="hidden rounded-lg px-2 py-1 text-[10px] text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)] sm:inline"
          >
            Dev
          </Link>
        ) : null}
        <div className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-2">
          {user.image ? (
            <img
              src={user.image}
              alt=""
              className="h-7 w-7 rounded-full"
              suppressHydrationWarning
            />
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-xs font-semibold text-white">
              {user.displayName.charAt(0)}
            </div>
          )}
          <span className="hidden text-xs sm:inline">{user.displayName}</span>
          <button
            type="button"
            onClick={onSignOut}
            className="ml-1 rounded-md px-2 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-text)]"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
