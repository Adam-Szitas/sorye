'use client';

import type { SubscriptionPlan, SubscriptionTierId } from '@sorye/types';
import { SUBSCRIPTION_PLANS } from '@sorye/types';
import Link from 'next/link';
import { useState } from 'react';

function formatLimit(value: number): string {
  return value >= 999 ? '∞' : String(value);
}

function formatPrice(plan: SubscriptionPlan): string {
  if (plan.priceMonthly === 0) return 'Free';
  return `$${plan.priceMonthly}/mo`;
}

interface DevPlanFormProps {
  email: string;
  currentPlanId: SubscriptionTierId;
  applyPlan: (formData: FormData) => Promise<void>;
}

export function DevPlanForm({
  email,
  currentPlanId,
  applyPlan,
}: DevPlanFormProps) {
  const [selectedId, setSelectedId] = useState<SubscriptionTierId>(
    currentPlanId === 'free' ? 'enterprise' : currentPlanId,
  );

  const currentPlan =
    SUBSCRIPTION_PLANS.find((p) => p.id === currentPlanId) ??
    SUBSCRIPTION_PLANS[0];

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="glass rounded-2xl p-6 shadow-2xl sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-amber-400/90">
              Development only
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Dev Console
            </h1>
            <p className="mt-2 max-w-xl text-sm text-[var(--color-text-muted)]">
              Switch your subscription tier for local testing. Updates your
              personal and team workspaces instantly.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
          >
            ← Back to Hub
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-sm font-semibold text-white">
            {email.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{email}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Current plan:{' '}
              <span style={{ color: currentPlan.accent }}>{currentPlan.name}</span>
            </p>
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide"
            style={{
              background: `${currentPlan.accent}22`,
              color: currentPlan.accent,
            }}
          >
            Active
          </span>
        </div>

        <form action={applyPlan} className="mt-8">
          <fieldset>
            <legend className="mb-4 text-sm font-medium text-[var(--color-text)]">
              Choose a plan to apply
            </legend>

            <div className="grid gap-3 sm:grid-cols-2">
              {SUBSCRIPTION_PLANS.map((plan) => {
                const isSelected = selectedId === plan.id;
                const isCurrent = currentPlanId === plan.id;

                return (
                  <label
                    key={plan.id}
                    className={[
                      'group relative cursor-pointer rounded-2xl border p-4 transition',
                      'hover:border-white/20 hover:bg-white/[0.04]',
                      isSelected
                        ? 'bg-white/[0.05]'
                        : 'border-white/10 bg-white/[0.02]',
                    ].join(' ')}
                    style={
                      isSelected
                        ? {
                            borderColor: `${plan.accent}99`,
                            boxShadow: `0 0 24px ${plan.accent}18`,
                          }
                        : undefined
                    }
                  >
                    <input
                      type="radio"
                      name="subscriptionId"
                      value={plan.id}
                      checked={isSelected}
                      onChange={() => setSelectedId(plan.id)}
                      className="sr-only"
                    />

                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-[var(--color-surface)]"
                          style={{ background: plan.accent }}
                          aria-hidden
                        >
                          {plan.name.charAt(0)}
                        </span>
                        <div>
                          <p className="font-semibold leading-tight">
                            {plan.name}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                            {formatPrice(plan)}
                          </p>
                        </div>
                      </div>

                      <span
                        className={[
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition',
                          isSelected
                            ? 'border-transparent text-[var(--color-surface)]'
                            : 'border-white/20 bg-transparent',
                        ].join(' ')}
                        style={
                          isSelected
                            ? { background: plan.accent }
                            : undefined
                        }
                        aria-hidden
                      >
                        {isSelected ? (
                          <svg
                            viewBox="0 0 12 12"
                            className="h-3 w-3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M2 6l3 3 5-5" />
                          </svg>
                        ) : null}
                      </span>
                    </div>

                    <p className="mt-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
                      {plan.description}
                    </p>

                    <ul className="mt-3 flex flex-wrap gap-2">
                      <li className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-[var(--color-text-muted)]">
                        {formatLimit(plan.maxApps)} apps
                      </li>
                      <li className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-[var(--color-text-muted)]">
                        {formatLimit(plan.maxConnections)} connections
                      </li>
                      {plan.allowsTeamWorkspace ? (
                        <li className="rounded-md bg-white/5 px-2 py-1 text-[10px] text-[var(--color-text-muted)]">
                          Teams
                        </li>
                      ) : null}
                    </ul>

                    {isCurrent ? (
                      <span className="absolute right-3 top-3 rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                        Current
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={selectedId === currentPlanId}
            className="mt-6 w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {selectedId === currentPlanId
              ? 'Already on this plan'
              : `Apply ${SUBSCRIPTION_PLANS.find((p) => p.id === selectedId)?.name ?? 'plan'}`}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-[var(--color-text-muted)]">
          Tip: use{' '}
          <code className="text-[var(--color-accent)]">STORE_DRIVER=postgres</code>{' '}
          so workspace state persists between restarts.
        </p>
      </div>
    </div>
  );
}
