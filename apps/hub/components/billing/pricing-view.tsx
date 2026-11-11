'use client';

import { useI18n } from '@sorye/platform/react';
import type { BillingInterval, SubscriptionPlan } from '@sorye/types';
import { useState } from 'react';
import { IntervalToggle, PlanGrid, RECOMMENDED_TIER } from '@/components/billing/plan-grid';
import { GHOST_BTN, PRIMARY_BTN } from '@/components/forms-ui';
import { StandaloneAppBar } from '@/components/standalone-app-bar';
import { contactCopy } from '@/lib/contact-copy';

export function salesMailto(plan: SubscriptionPlan): string {
  return `mailto:${contactCopy.email}?subject=${encodeURIComponent(`Sorye ${plan.name}`)}`;
}

/** Public plan comparison. Choosing a plan continues on the signed-in /billing page. */
export function PricingView() {
  const { t, locale } = useI18n();
  const [interval, setBillingInterval] = useState<BillingInterval>('year');
  return (
    <div lang={locale} className="flex min-h-dvh flex-col">
      <StandaloneAppBar appName={t('billing.choosePlan')} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-10 sm:pt-16">
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{t('billing.pricingTitle')}</h1>
          <p className="mt-4 text-base text-[var(--color-text-muted)] sm:text-lg">{t('billing.pricingLead')}</p>
          <div className="mt-8 flex justify-center"><IntervalToggle value={interval} onChange={setBillingInterval} /></div>
        </header>
        <div className="mt-10">
          <PlanGrid
            interval={interval}
            action={(plan) =>
              plan.salesLed ? (
                <a className={`${GHOST_BTN} w-full border border-white/15`} href={salesMailto(plan)}>{t('billing.cta.contact')}</a>
              ) : (
                <a className={`${plan.id === RECOMMENDED_TIER ? PRIMARY_BTN : `${GHOST_BTN} border border-white/15 text-[var(--color-text)]`} w-full`} href="/billing">
                  {plan.priceMonthly === 0 ? t('billing.cta.startFree') : t('billing.cta.choose', { plan: plan.name })}
                </a>
              )
            }
          />
        </div>
        <p className="mt-8 text-center text-xs text-[var(--color-text-muted)]">{t('billing.vatNote')}</p>
      </main>
    </div>
  );
}
