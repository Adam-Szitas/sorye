'use client';

import { useI18n } from '@sorye/platform/react';
import type { MessageKey } from '@sorye/platform';
import {
  BILLING_SIMULATIONS,
  SUBSCRIPTION_PLANS,
  compareTiers,
  effectiveTier,
  getPlanById,
  planLimit,
  planPrice,
  type BillingCommand,
  type BillingCommandResult,
  type BillingInterval,
  type BillingSimulation,
  type BillingSnapshot,
  type BillingStatus,
  type LimitUsage,
  type SubscriptionPlan,
} from '@sorye/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IntervalToggle, PlanGrid, RECOMMENDED_TIER, formatDate, formatMoney } from '@/components/billing/plan-grid';
import { salesMailto } from '@/components/billing/pricing-view';
import { CARD_CLASS, DANGER_BTN, GHOST_BTN, Icon, PRIMARY_BTN } from '@/components/forms-ui';
import { StandaloneAppBar } from '@/components/standalone-app-bar';
import { contactCopy } from '@/lib/contact-copy';

const STATUS_LABEL: Record<BillingStatus, MessageKey> = {
  free: 'billing.status.free', active: 'billing.status.active', canceling: 'billing.status.canceling',
  past_due: 'billing.status.past_due', grace: 'billing.status.grace',
};
const STATUS_TONE: Record<BillingStatus, string> = {
  free: 'border-white/15 text-[var(--color-text-muted)]',
  active: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  canceling: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
  past_due: 'border-red-400/30 bg-red-400/10 text-red-200',
  grace: 'border-red-400/30 bg-red-400/10 text-red-200',
};
const SIM_LABEL: Record<BillingSimulation, MessageKey> = {
  payment_failed: 'billing.sim.payment_failed', retries_exhausted: 'billing.sim.retries_exhausted', grace_expired: 'billing.sim.grace_expired',
  payment_recovered: 'billing.sim.payment_recovered', period_ended: 'billing.sim.period_ended',
};

/** A pending confirmation. `unavailable` explains that no payment provider is connected yet. */
type Pending =
  | { kind: 'change'; plan: SubscriptionPlan; interval: BillingInterval; direction: 'up' | 'down' | 'interval' }
  | { kind: 'cancel' }
  | { kind: 'unavailable'; plan: SubscriptionPlan };

function lockedOn(usage: LimitUsage, limit: number): number {
  const max = planLimit(limit);
  return max === null ? 0 : Math.max(0, usage.used - max);
}

function Meter({ label, used, limit, locked }: { label: string; used: number; limit: number | null; locked: number }) {
  const { t } = useI18n();
  const ratio = limit === null ? 0 : limit === 0 ? (used > 0 ? 1 : 0) : Math.min(1, used / limit);
  const full = limit !== null && used >= limit;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-[var(--color-text-muted)]">
          {limit === null ? `${used} · ${t('billing.unlimited')}` : limit === 0 ? t('billing.notIncluded') : t('billing.usageOf', { used, limit })}
        </span>
      </div>
      {limit !== 0 ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8" aria-hidden="true">
          <div className={`h-full rounded-full ${locked > 0 ? 'bg-red-400' : full ? 'bg-amber-300' : 'bg-[var(--color-accent)]'}`} style={{ width: `${limit === null ? 8 : Math.max(ratio * 100, used > 0 ? 4 : 0)}%` }} />
        </div>
      ) : null}
      {locked > 0 ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-200"><Icon.lock className="size-3.5" />{t('billing.locked', { n: locked })}</p>
      ) : null}
    </div>
  );
}

export function BillingView({ workspaceName }: { workspaceName: string }) {
  const { t, locale } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [interval, setBillingInterval] = useState<BillingInterval>('month');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const response = await fetch('/api/billing', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const next = (await response.json()) as BillingSnapshot;
      setSnapshot(next);
      setBillingInterval(next.state.status === 'free' ? 'year' : next.state.interval);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (pending && !dialog.open) dialog.showModal();
    if (!pending && dialog.open) dialog.close();
  }, [pending]);

  async function send(url: string, body: unknown, success: (next: BillingSnapshot) => string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = (await response.json().catch(() => ({ ok: false, code: 'invalid' }))) as BillingCommandResult;
      if (result.ok) {
        setSnapshot(result.snapshot);
        setMessage({ tone: 'ok', text: success(result.snapshot) });
      } else {
        setMessage({
          tone: 'error',
          text: result.code === 'forbidden' ? t('billing.ownerOnly') : result.code === 'unavailable' ? t('billing.unavailable') : result.code === 'no_change' ? t('billing.error.noChange') : t('billing.error.failed'),
        });
      }
    } catch {
      setMessage({ tone: 'error', text: t('billing.error.failed') });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  function command(body: BillingCommand) {
    return send('/api/billing', body, (next) =>
      body.action === 'cancel' ? t('billing.done.canceled', { date: formatDate(next.state.periodEndsAt, locale) })
      : body.action === 'resume' ? t('billing.done.resumed')
      : t('billing.done.changed'));
  }

  function simulate(event: BillingSimulation) {
    return send('/api/billing/simulate', { event }, () => t('billing.done.simulated'));
  }

  if (!snapshot) {
    return (
      <div className="flex min-h-dvh flex-col">
        <StandaloneAppBar appName={t('billing.title')} />
        <main className="flex flex-1 items-center justify-center p-6" role={loadFailed ? 'alert' : 'status'}>
          {loadFailed ? (
            <div className="text-center">
              <p className="text-sm text-red-300">{t('billing.loadFailed')}</p>
              <button type="button" className={`${GHOST_BTN} mt-3 border border-white/12`} onClick={() => void load()}><Icon.refresh />{t('forms.public.reload')}</button>
            </div>
          ) : (
            <span className="size-5 animate-spin rounded-full border-2 border-white/20 border-t-[var(--color-accent)] motion-reduce:animate-none" aria-label={t('loading')} />
          )}
        </main>
      </div>
    );
  }

  const { state, usage, mode, canManage } = snapshot;
  const simulated = mode === 'simulated';
  const tier = effectiveTier(state);
  const plan = getPlanById(SUBSCRIPTION_PLANS, tier);
  const paid = state.status !== 'free';
  const endDate = formatDate(state.graceEndsAt ?? state.periodEndsAt, locale) || t('billing.endOfPeriod');
  const scheduled = state.scheduledTierId && state.scheduledTierId !== 'free' ? getPlanById(SUBSCRIPTION_PLANS, state.scheduledTierId) : null;

  function choose(target: SubscriptionPlan) {
    if (!simulated) { setPending({ kind: 'unavailable', plan: target }); return; }
    if (target.id === 'free') { setPending({ kind: 'cancel' }); return; }
    const direction = compareTiers(tier, target.id);
    setPending({ kind: 'change', plan: target, interval, direction: direction > 0 ? 'up' : direction < 0 ? 'down' : 'interval' });
  }

  function planAction(target: SubscriptionPlan) {
    const isCurrent = target.id === tier && (target.id === 'free' || interval === state.interval);
    if (isCurrent && !state.scheduledTierId) return <button type="button" className={`${GHOST_BTN} w-full border border-white/10`} disabled>{t('billing.cta.current')}</button>;
    if (target.id === tier && target.id !== 'free' && interval === state.interval && state.scheduledTierId) {
      return <button type="button" className={`${PRIMARY_BTN} w-full`} disabled={!canManage || busy} onClick={() => void command({ action: 'resume' })}>{t('billing.resume')}</button>;
    }
    if (state.scheduledTierId === target.id) {
      return <button type="button" className={`${GHOST_BTN} w-full border border-white/10`} disabled>{t('billing.cta.scheduled', { date: endDate })}</button>;
    }
    if (target.salesLed && !simulated) return <a className={`${GHOST_BTN} w-full border border-white/15`} href={salesMailto(target)}>{t('billing.cta.contact')}</a>;
    const direction = compareTiers(tier, target.id);
    const label = direction === 0
      ? t(interval === 'year' ? 'billing.cta.toYearly' : 'billing.cta.toMonthly')
      : direction > 0 ? t('billing.cta.upgrade', { plan: target.name }) : t('billing.cta.downgrade', { plan: target.name });
    const primary = direction > 0 && (target.id === RECOMMENDED_TIER || tier === 'free');
    return (
      <button
        type="button" disabled={!canManage || busy}
        className={`${primary ? PRIMARY_BTN : `${GHOST_BTN} border border-white/15 text-[var(--color-text)]`} w-full`}
        onClick={() => choose(target)}
      >
        {label}
      </button>
    );
  }

  const pendingPlan = pending?.kind === 'change' ? pending.plan : pending?.kind === 'cancel' ? getPlanById(SUBSCRIPTION_PLANS, 'free') : null;
  const lockApps = pendingPlan ? lockedOn(usage.apps, pendingPlan.maxApps) : 0;
  const lockConnections = pendingPlan ? lockedOn(usage.connections, pendingPlan.maxConnections) : 0;

  return (
    <div lang={locale} className="flex min-h-dvh flex-col">
      <StandaloneAppBar appName={t('billing.title')} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pb-16 pt-8 sm:pt-12">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('billing.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('billing.workspace', { name: workspaceName })}</p>
        </header>

        {simulated ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
            <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-300 px-2 py-0.5 text-xs font-semibold text-slate-950">{t('billing.simulator')}</span>
            <p>{t('billing.simulatorNote')}</p>
          </div>
        ) : null}

        <div className="min-h-0 empty:hidden" role="status" aria-live="polite">
          {message ? (
            <p className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${message.tone === 'ok' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-red-400/30 bg-red-400/10 text-red-200'}`}>
              {message.tone === 'ok' ? <Icon.check className="mt-0.5 size-4 shrink-0" /> : <Icon.alert className="mt-0.5 size-4 shrink-0" />}{message.text}
            </p>
          ) : null}
        </div>

        {state.status === 'past_due' || state.status === 'grace' || state.status === 'canceling' || scheduled ? (
          <div className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${state.status === 'canceling' || scheduled ? 'border-amber-300/30 bg-amber-300/10' : 'border-red-400/30 bg-red-400/10'}`} role="alert">
            <Icon.alert className="size-5 shrink-0" />
            <p className="min-w-0 flex-1 text-sm">
              {state.status === 'past_due' ? t('billing.banner.pastDue')
                : state.status === 'grace' ? t('billing.banner.grace', { date: endDate })
                : state.status === 'canceling' ? t('billing.banner.canceling', { date: endDate })
                : t('billing.banner.scheduled', { plan: scheduled?.name ?? '', date: endDate })}
            </p>
            {canManage && (state.status === 'canceling' || scheduled) ? (
              <button type="button" className={PRIMARY_BTN} disabled={busy} onClick={() => void command({ action: 'resume' })}>{t('billing.resume')}</button>
            ) : null}
            {canManage && (state.status === 'past_due' || state.status === 'grace') ? (
              simulated
                ? <button type="button" className={PRIMARY_BTN} disabled={busy} onClick={() => void simulate('payment_recovered')}>{t('billing.updatePayment')}</button>
                : <a className={PRIMARY_BTN} href={`mailto:${contactCopy.email}`}>{t('billing.updatePayment')}</a>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section className={CARD_CLASS} aria-labelledby="billing-current">
            <h2 id="billing-current" className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('billing.currentPlan')}</h2>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="size-3 rounded-full" style={{ background: plan.accent }} aria-hidden="true" />
              <p className="text-2xl font-semibold tracking-tight">{plan.name}</p>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[state.status]}`}>{t(STATUS_LABEL[state.status])}</span>
            </div>
            {paid ? (
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-[var(--color-text-muted)]">{t(state.interval === 'year' ? 'billing.interval.year' : 'billing.interval.month')}</dt>
                <dd className="tabular-nums">{formatMoney(planPrice(plan, state.interval), locale)} {t(state.interval === 'year' ? 'billing.perYear' : 'billing.perMonth')}</dd>
                {state.status === 'active' && state.periodEndsAt && !scheduled ? (
                  <><dt className="sr-only">{t('billing.renews', { date: '' })}</dt><dd className="col-span-2 text-[var(--color-text-muted)]">{t('billing.renews', { date: formatDate(state.periodEndsAt, locale) })}</dd></>
                ) : null}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">{t('billing.plan.free')}</p>
            )}
            {!canManage ? <p className="mt-4 flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><Icon.lock className="size-3.5" />{t('billing.ownerOnly')}</p> : null}
            {canManage && paid && state.status === 'active' && !scheduled ? (
              <button type="button" className={`${DANGER_BTN} mt-5`} disabled={busy} onClick={() => (simulated ? setPending({ kind: 'cancel' }) : setPending({ kind: 'unavailable', plan }))}>{t('billing.cancel')}</button>
            ) : null}
          </section>

          <section className={CARD_CLASS} aria-labelledby="billing-usage">
            <h2 id="billing-usage" className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('billing.usage')}</h2>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <Meter label={t('billing.limit.apps')} used={usage.apps.used} limit={usage.apps.limit} locked={usage.apps.lockedIds.length} />
              <Meter label={t('billing.limit.connections')} used={usage.connections.used} limit={usage.connections.limit} locked={usage.connections.lockedIds.length} />
              <Meter label={t('billing.limit.teams')} used={usage.teamWorkspaces.used} limit={usage.teamWorkspaces.limit} locked={0} />
              <Meter label={t('billing.limit.members')} used={usage.teamMembers.used} limit={usage.teamMembers.limit} locked={0} />
            </div>
            {usage.apps.lockedIds.length + usage.connections.lockedIds.length > 0 ? (
              <p className="mt-4 text-xs text-[var(--color-text-muted)]">{t('billing.lockedHelp')}</p>
            ) : null}
          </section>
        </div>

        <section aria-labelledby="billing-plans" className="mt-2">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 id="billing-plans" className="text-lg font-semibold tracking-tight">{t('billing.choosePlan')}</h2>
            <IntervalToggle value={interval} onChange={setBillingInterval} />
          </div>
          <PlanGrid interval={interval} current={tier} action={planAction} />
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">{t('billing.vatNote')}</p>
        </section>

        {simulated && canManage ? (
          <section className="rounded-2xl border border-dashed border-amber-300/40 p-4 sm:p-5" aria-labelledby="billing-sim">
            <h2 id="billing-sim" className="flex items-center gap-2 text-sm font-semibold">
              <span className="rounded-full bg-amber-300 px-2 py-0.5 text-xs text-slate-950">{t('billing.simulator')}</span>{t('billing.simulatorEvents')}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {BILLING_SIMULATIONS.map((event) => (
                <button key={event} type="button" className={`${GHOST_BTN} border border-amber-300/30 text-amber-100`} disabled={busy} onClick={() => void simulate(event)}>{t(SIM_LABEL[event])}</button>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <dialog
        ref={dialogRef}
        aria-labelledby="billing-dialog-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-white/12 bg-[var(--color-surface-raised)] p-0 text-[var(--color-text)] shadow-2xl backdrop:bg-black/60"
        onClose={() => setPending(null)}
      >
        {pending ? (
          <div className="p-5 sm:p-6">
            <h2 id="billing-dialog-title" className="text-lg font-semibold tracking-tight">
              {pending.kind === 'unavailable' ? pending.plan.name
                : pending.kind === 'cancel' ? t('billing.confirm.cancelTitle')
                : pending.direction === 'down' ? t('billing.confirm.downgradeTitle', { plan: pending.plan.name })
                : pending.direction === 'up' ? t('billing.confirm.upgradeTitle', { plan: pending.plan.name })
                : t(pending.interval === 'year' ? 'billing.cta.toYearly' : 'billing.cta.toMonthly')}
            </h2>
            <div className="mt-3 flex flex-col gap-3 text-sm text-[var(--color-text-muted)]">
              {pending.kind === 'unavailable' ? <p>{t('billing.unavailable')}</p> : null}
              {pending.kind === 'cancel' ? <p>{t('billing.confirm.cancelBody', { plan: plan.name, date: endDate })}</p> : null}
              {pending.kind === 'change' && pending.direction === 'down' ? <p>{t('billing.confirm.downgradeBody', { date: endDate })}</p> : null}
              {pending.kind === 'change' && pending.direction !== 'down' ? (
                <p>{t('billing.confirm.upgradeBody', { price: `${formatMoney(planPrice(pending.plan, pending.interval), locale)} ${t(pending.interval === 'year' ? 'billing.perYear' : 'billing.perMonth')}` })}</p>
              ) : null}
              {pending.kind !== 'unavailable' && (lockApps > 0 || lockConnections > 0) ? (
                <p className="flex items-start gap-2 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-amber-100">
                  <Icon.lock className="mt-0.5 size-4 shrink-0" />
                  {t('billing.confirm.lockWarning', { plan: pendingPlan?.name ?? '', apps: lockApps, connections: lockConnections })}
                </p>
              ) : null}
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" className={GHOST_BTN} autoFocus onClick={() => setPending(null)}>{t('billing.confirm.back')}</button>
              {pending.kind === 'unavailable' ? (
                <a className={PRIMARY_BTN} href={salesMailto(pending.plan)}>{t('billing.contactEmail')}</a>
              ) : (
                <button
                  type="button" disabled={busy}
                  className={pending.kind === 'cancel' ? `${DANGER_BTN} bg-red-500/15` : PRIMARY_BTN}
                  onClick={() => void (pending.kind === 'cancel' ? command({ action: 'cancel' }) : command({ action: 'change', tierId: pending.plan.id, interval: pending.interval }))}
                >
                  {t('billing.confirm.confirm')}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
