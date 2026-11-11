import {
  BILLING_GRACE_DAYS,
  compareTiers,
  effectiveTier,
  type BillingCommand,
  type BillingInterval,
  type BillingSimulation,
  type BillingState,
} from '@sorye/types';

/**
 * Billing state machine, free of I/O. The simulator applies it today; a real
 * payment provider's webhooks will map onto the same transitions.
 * See docs/SUBSCRIPTIONS.md for the full state diagram.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function periodEnd(interval: BillingInterval, from = Date.now()): string {
  const end = new Date(from);
  if (interval === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end.toISOString();
}

export function freeState(): BillingState {
  return { tierId: 'free', interval: 'month', status: 'free', periodEndsAt: null, graceEndsAt: null, scheduledTierId: null };
}

/** Pure transition for a member's command. Returns null when the command changes nothing. */
export function applyCommand(state: BillingState, command: BillingCommand, now = Date.now()): BillingState | null {
  if (command.action === 'cancel') {
    if (state.status === 'free' || state.status === 'canceling') return null;
    return { ...state, status: 'canceling', scheduledTierId: 'free', periodEndsAt: state.periodEndsAt ?? periodEnd(state.interval, now) };
  }
  if (command.action === 'resume') {
    if (state.status !== 'canceling' && state.scheduledTierId === null) return null;
    return { ...state, status: 'active', scheduledTierId: null };
  }
  const current = effectiveTier(state);
  if (command.tierId === 'free') return applyCommand(state, { action: 'cancel' }, now);
  const direction = compareTiers(current, command.tierId);
  if (direction === 0 && command.interval === state.interval && state.scheduledTierId === null) return null;
  if (direction < 0) {
    // Downgrades between paid tiers wait for the end of the paid period.
    return { ...state, status: 'active', scheduledTierId: command.tierId };
  }
  // Upgrades, interval switches and starting from Free take effect at once with a new period.
  return {
    tierId: command.tierId,
    interval: command.interval,
    status: 'active',
    periodEndsAt: periodEnd(command.interval, now),
    graceEndsAt: null,
    scheduledTierId: null,
  };
}

/** Pure transition for a simulated provider event. Returns null when the event does not apply. */
export function applySimulation(state: BillingState, event: BillingSimulation, now = Date.now()): BillingState | null {
  switch (event) {
    case 'payment_failed':
      return state.status === 'active' || state.status === 'canceling' ? { ...state, status: 'past_due' } : null;
    case 'retries_exhausted':
      return state.status === 'past_due' ? { ...state, status: 'grace', graceEndsAt: new Date(now + BILLING_GRACE_DAYS * DAY_MS).toISOString() } : null;
    case 'grace_expired':
      return state.status === 'grace' ? freeState() : null;
    case 'payment_recovered':
      return state.status === 'past_due' || state.status === 'grace'
        ? { ...state, status: state.scheduledTierId === 'free' ? 'canceling' : 'active', graceEndsAt: null, periodEndsAt: periodEnd(state.interval, now) }
        : null;
    case 'period_ended': {
      if (state.status === 'free') return null;
      if (state.status === 'past_due' || state.status === 'grace') return null;
      const next = state.scheduledTierId;
      if (next === 'free') return freeState();
      return {
        ...state,
        tierId: next ?? state.tierId,
        status: 'active',
        scheduledTierId: null,
        periodEndsAt: periodEnd(state.interval, now),
      };
    }
  }
}
