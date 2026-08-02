import type {
  AppCatalogEntry,
  SubscriptionPlan,
  SubscriptionSource,
} from '@sorye/types';
import { canSelectMoreApps } from '@sorye/types';
import { AppIcon } from './app-icon';

interface AppPickerProps {
  catalog: AppCatalogEntry[];
  selectedIds: string[];
  plan: SubscriptionPlan;
  subscriptionSource: SubscriptionSource;
  onToggleApp: (appId: string) => void;
  onClose: () => void;
}

export function AppPicker({
  catalog,
  selectedIds,
  plan,
  subscriptionSource,
  onToggleApp,
  onClose,
}: AppPickerProps) {
  const selectedSet = new Set(selectedIds);
  const atLimit = !canSelectMoreApps(plan, selectedIds.length);

  return (
    <section className="mx-auto w-full max-w-4xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">App Library</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Select up to {plan.maxApps === 999 ? 'unlimited' : plan.maxApps}{' '}
            apps for your workspace
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
        >
          Done
        </button>
      </div>

      <div className="surface mb-8 rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">{plan.name} plan</h3>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {plan.maxApps === 999 ? '∞' : plan.maxApps} apps ·{' '}
              {plan.maxConnections === 999 ? '∞' : plan.maxConnections}{' '}
              connections
              {plan.allowsTeamWorkspace &&
                ` · up to ${plan.maxTeamWorkspaces} team${plan.maxTeamWorkspaces === 1 ? '' : 's'}`}
            </p>
          </div>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            {subscriptionSource === 'admin' ? 'Admin assigned' : 'Stripe'}
          </span>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-[var(--color-text-muted)]">
          {selectedIds.length} /{' '}
          {plan.maxApps === 999 ? '∞' : plan.maxApps} selected
        </span>
        {atLimit && (
          <span className="text-xs text-amber-400">
            App limit reached — contact admin to upgrade
          </span>
        )}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {catalog.map((app) => {
          const isSelected = selectedSet.has(app.id);
          const disabled = !isSelected && atLimit;

          return (
            <li key={app.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onToggleApp(app.id)}
                className={`flex w-full items-center gap-4 rounded-xl p-4 text-left transition ${
                  isSelected
                    ? 'surface ring-1 ring-white/20'
                    : 'bg-white/5 hover:bg-white/8'
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <AppIcon app={app} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{app.name}</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-[var(--color-text-muted)]">
                      {app.category}
                    </span>
                    {app.status === 'available' && (
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] uppercase text-emerald-400">
                        Live
                      </span>
                    )}
                    {app.status === 'beta' && (
                      <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] uppercase text-violet-300">
                        Beta
                      </span>
                    )}
                    {app.external && (
                      <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] uppercase text-sky-300">
                        External
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                    {app.description}
                  </p>
                </div>
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
                    isSelected
                      ? 'border-transparent text-white'
                      : 'border-white/20'
                  }`}
                  style={{
                    background: isSelected ? plan.accent : 'transparent',
                  }}
                  aria-hidden
                >
                  {isSelected && (
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none">
                      <path
                        d="M3 8l3.5 3.5L13 5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
