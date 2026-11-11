import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SUBSCRIPTION_PLANS,
  billingUsage,
  compareTiers,
  effectiveTier,
  getPlanById,
  isBillingCommand,
  isBillingSimulation,
  type BillingState,
} from '@sorye/types';
import { applyCommand, applySimulation, freeState } from '../lib/billing/transitions';

const NOW = Date.parse('2026-11-11T12:00:00Z');

function active(tierId: BillingState['tierId'], interval: BillingState['interval'] = 'month'): BillingState {
  return { tierId, interval, status: 'active', periodEndsAt: '2026-12-11T12:00:00.000Z', graceEndsAt: null, scheduledTierId: null };
}

test('free tier is first and costs nothing; yearly is ten months', () => {
  assert.equal(SUBSCRIPTION_PLANS[0]?.id, 'free');
  for (const plan of SUBSCRIPTION_PLANS) {
    assert.equal(plan.priceYearly, plan.priceMonthly * 10, plan.id);
  }
  assert.equal(getPlanById(SUBSCRIPTION_PLANS, 'enterprise').salesLed, true);
  assert.equal(SUBSCRIPTION_PLANS.filter((plan) => plan.salesLed).length, 1);
});

test('tier order drives upgrade and downgrade', () => {
  assert.equal(compareTiers('free', 'pro'), 1);
  assert.equal(compareTiers('pro', 'starter'), -1);
  assert.equal(compareTiers('pro', 'pro'), 0);
});

test('upgrading from Free starts a paid period at once', () => {
  const next = applyCommand(freeState(), { action: 'change', tierId: 'pro', interval: 'year' }, NOW);
  assert.ok(next);
  assert.equal(next.status, 'active');
  assert.equal(next.tierId, 'pro');
  assert.equal(next.periodEndsAt, '2027-11-11T12:00:00.000Z');
  assert.equal(effectiveTier(next), 'pro');
});

test('downgrading between paid tiers waits for the period end', () => {
  const next = applyCommand(active('pro'), { action: 'change', tierId: 'starter', interval: 'month' }, NOW);
  assert.ok(next);
  assert.equal(effectiveTier(next), 'pro');
  assert.equal(next.scheduledTierId, 'starter');
  const ended = applySimulation(next, 'period_ended', NOW);
  assert.ok(ended);
  assert.equal(ended.tierId, 'starter');
  assert.equal(ended.scheduledTierId, null);
});

test('cancel keeps paid limits until the period ends, resume undoes it', () => {
  const canceling = applyCommand(active('starter'), { action: 'cancel' }, NOW);
  assert.ok(canceling);
  assert.equal(canceling.status, 'canceling');
  assert.equal(effectiveTier(canceling), 'starter');
  assert.deepEqual(applyCommand(canceling, { action: 'resume' }, NOW)?.status, 'active');
  const ended = applySimulation(canceling, 'period_ended', NOW);
  assert.deepEqual(ended, freeState());
  assert.equal(applyCommand(freeState(), { action: 'cancel' }, NOW), null);
});

test('choosing Free is the same as cancelling', () => {
  const next = applyCommand(active('pro'), { action: 'change', tierId: 'free', interval: 'month' }, NOW);
  assert.equal(next?.status, 'canceling');
  assert.equal(next?.scheduledTierId, 'free');
});

test('failed payment, grace and expiry', () => {
  const pastDue = applySimulation(active('pro'), 'payment_failed', NOW);
  assert.equal(pastDue?.status, 'past_due');
  assert.equal(effectiveTier(pastDue!), 'pro');
  const grace = applySimulation(pastDue!, 'retries_exhausted', NOW);
  assert.equal(grace?.status, 'grace');
  assert.equal(grace?.graceEndsAt, '2026-11-18T12:00:00.000Z');
  assert.equal(effectiveTier(grace!), 'pro');
  assert.deepEqual(applySimulation(grace!, 'grace_expired', NOW), freeState());
  const recovered = applySimulation(grace!, 'payment_recovered', NOW);
  assert.equal(recovered?.status, 'active');
  assert.equal(recovered?.graceEndsAt, null);
});

test('events that do not apply change nothing', () => {
  assert.equal(applySimulation(freeState(), 'payment_failed', NOW), null);
  assert.equal(applySimulation(active('pro'), 'grace_expired', NOW), null);
  assert.equal(applySimulation(active('pro'), 'retries_exhausted', NOW), null);
  assert.equal(applyCommand(active('pro'), { action: 'change', tierId: 'pro', interval: 'month' }, NOW), null);
});

test('over-limit items are locked, never removed', () => {
  const workspace = {
    selectedAppIds: ['notes', 'tasks', 'calendar', 'forms'],
    connectedApps: [
      { id: 'c1', name: 'a', endpoint: 'https://a.example', apiKeyHint: '', status: 'active' as const, connectedAt: '', scopes: [] },
      { id: 'c2', name: 'b', endpoint: 'https://b.example', apiKeyHint: '', status: 'active' as const, connectedAt: '', scopes: [] },
    ],
    memberIds: ['u1'],
  };
  const usage = billingUsage(workspace, getPlanById(SUBSCRIPTION_PLANS, 'free'), 0);
  assert.equal(usage.apps.limit, 2);
  assert.deepEqual(usage.apps.lockedIds, workspace.selectedAppIds.slice(2));
  assert.deepEqual(usage.connections.lockedIds, ['c2']);
  assert.equal(workspace.selectedAppIds.length, 4);
  const unlimited = billingUsage(workspace, getPlanById(SUBSCRIPTION_PLANS, 'enterprise'), 0);
  assert.equal(unlimited.apps.limit, null);
  assert.deepEqual(unlimited.apps.lockedIds, []);
});

test('request parsing rejects anything outside the contract', () => {
  assert.equal(isBillingCommand({ action: 'change', tierId: 'pro', interval: 'year' }), true);
  assert.equal(isBillingCommand({ action: 'change', tierId: 'gold', interval: 'year' }), false);
  assert.equal(isBillingCommand({ action: 'change', tierId: 'pro', interval: 'week' }), false);
  assert.equal(isBillingCommand({ action: 'change', tierId: 'pro', interval: 'year', workspaceId: 'ws-x' }), false);
  assert.equal(isBillingCommand({ action: 'cancel', workspaceId: 'ws-x' }), false);
  assert.equal(isBillingCommand({ action: 'resume' }), true);
  assert.equal(isBillingSimulation('payment_failed'), true);
  assert.equal(isBillingSimulation('refund_everything'), false);
});
