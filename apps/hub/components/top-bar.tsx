import type { HubUser, SubscriptionPlan, Workspace } from '@sorye/types';import { SubscriptionBadge } from './subscription-badge';

interface TopBarProps {
  user: HubUser;
  workspace: Workspace;
  plan: SubscriptionPlan;
  onOpenPicker: () => void;
  onOpenConnections: () => void;
  onSignOut: () => void;
}

export function TopBar({
  user,
  workspace,
  plan,
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
        <div className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-2">
          {user.image ? (
            <img
              src={user.image}
              alt=""
              className="h-7 w-7 rounded-full"
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
