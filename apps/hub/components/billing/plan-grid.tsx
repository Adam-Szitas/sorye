'use client';

import { useI18n } from '@sorye/platform/react';
import type { MessageKey } from '@sorye/platform';
import {
  PLAN_CURRENCY,
  SUBSCRIPTION_PLANS,
  planLimit,
  planPrice,
  type BillingInterval,
  type SubscriptionPlan,
  type SubscriptionTierId,
} from '@sorye/types';
import type { ReactNode } from 'react';
import { Icon } from '@/components/forms-ui';

const PLAN_DESCRIPTION: Record<SubscriptionTierId, MessageKey> = {
  free: 'billing.plan.free', starter: 'billing.plan.starter', pro: 'billing.plan.pro', enterprise: 'billing.plan.enterprise',
};

/** The plan most people should pick; highlighted on the grid. */
export const RECOMMENDED_TIER: SubscriptionTierId = 'pro';

export function formatMoney(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: PLAN_CURRENCY, maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' });
}

export function IntervalToggle({ value, onChange }: { value: BillingInterval; onChange: (next: BillingInterval) => void }) {
  const { t } = useI18n();
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1" role="radiogroup" aria-label={t('billing.intervalLabel')}>
      {(['month', 'year'] as const).map((interval) => (
        <label
          key={interval}
          className={`relative inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-accent)] ${value === interval ? 'bg-white/12 text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
        >
          <input type="radio" name="billing-interval" className="sr-only" checked={value === interval} onChange={() => onChange(interval)} />
          {t(interval === 'month' ? 'billing.monthly' : 'billing.yearly')}
          {interval === 'year' ? (
            <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-medium text-emerald-300">{t('billing.yearlySave')}</span>
          ) : null}
        </label>
      ))}
    </div>
  );
}

function LimitRow({ label, value }: { label: string; value: number | null | false }) {
  const { t } = useI18n();
  const included = value !== false;
  return (
    <li className={`flex items-center gap-2.5 text-sm ${included ? '' : 'text-[var(--color-text-muted)]'}`}>
      <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${included ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'bg-white/5'}`} aria-hidden="true">
        {included ? <Icon.check className="size-3" /> : <span className="h-px w-2 bg-current" />}
      </span>
      <span className="flex-1">{label}</span>
      <span className="font-medium tabular-nums">{value === false ? t('billing.notIncluded') : value === null ? t('billing.unlimited') : value}</span>
    </li>
  );
}

export function PlanCard({ plan, interval, current, children }: { plan: SubscriptionPlan; interval: BillingInterval; current: boolean; children: ReactNode }) {
  const { t, locale } = useI18n();
  const recommended = plan.id === RECOMMENDED_TIER;
  const price = planPrice(plan, interval);
  const headingId = `plan-${plan.id}`;
  return (
    <article
      aria-labelledby={headingId}
      className={`relative flex flex-col rounded-2xl border p-5 sm:p-6 ${recommended ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/[0.06] shadow-[0_0_0_1px_var(--color-accent)_inset,0_20px_50px_-24px_rgba(56,189,248,0.45)]' : 'border-white/10 bg-[var(--color-surface-raised)]/70'}`}
    >
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: plan.accent }} aria-hidden="true" />
        <h3 id={headingId} className="text-base font-semibold">{plan.name}</h3>
        {recommended ? <span className="ml-auto rounded-full bg-[var(--color-accent)] px-2.5 py-0.5 text-xs font-semibold text-slate-950">{t('billing.popular')}</span> : null}
        {current && !recommended ? <span className="ml-auto rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-[var(--color-text-muted)]">{t('billing.cta.current')}</span> : null}
      </div>
      <p className="mt-2 min-h-10 text-sm text-[var(--color-text-muted)]">{t(PLAN_DESCRIPTION[plan.id])}</p>
      <p className="mt-5 flex items-baseline gap-1.5">
        {plan.salesLed ? <span className="text-sm text-[var(--color-text-muted)]">{t('billing.from')}</span> : null}
        <span className="text-4xl font-semibold tracking-tight tabular-nums">{formatMoney(price, locale)}</span>
        {price > 0 ? <span className="text-sm text-[var(--color-text-muted)]">{t(interval === 'year' ? 'billing.perYear' : 'billing.perMonth')}</span> : null}
      </p>
      <ul className="mt-6 flex flex-col gap-2.5 border-t border-white/8 pt-5">
        <LimitRow label={t('billing.limit.apps')} value={planLimit(plan.maxApps)} />
        <LimitRow label={t('billing.limit.connections')} value={planLimit(plan.maxConnections)} />
        <LimitRow label={t('billing.limit.teams')} value={plan.allowsTeamWorkspace ? planLimit(plan.maxTeamWorkspaces) : false} />
        <LimitRow label={t('billing.limit.members')} value={plan.allowsTeamWorkspace ? planLimit(plan.maxTeamMembers) : false} />
      </ul>
      <div className="mt-auto pt-6">{children}</div>
    </article>
  );
}

export function PlanGrid({ interval, current, action }: {
  interval: BillingInterval;
  current?: SubscriptionTierId;
  action: (plan: SubscriptionPlan) => ReactNode;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {SUBSCRIPTION_PLANS.map((plan) => (
        <PlanCard key={plan.id} plan={plan} interval={interval} current={plan.id === current}>
          {action(plan)}
        </PlanCard>
      ))}
    </div>
  );
}
