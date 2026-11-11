/**
 * Self-service subscription contract, provider-agnostic.
 *
 * Hub owns billing state per workspace and derives the workspace from the
 * server session. A payment provider (none is wired yet) reports changes to
 * Hub; the browser never decides which plan a workspace has.
 * Full flow design: docs/SUBSCRIPTIONS.md.
 */
import { APP_CATALOG, isAlwaysAvailableApp } from './apps';
import { SUBSCRIPTION_PLANS, type SubscriptionPlan, type SubscriptionTierId } from './subscription';
import type { Workspace } from './workspace';

export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/**
 * - `free`: no paid subscription.
 * - `active`: paid and renewing.
 * - `canceling`: paid until `periodEndsAt`, then drops to Free.
 * - `past_due`: the last renewal payment failed; the provider is retrying.
 * - `grace`: retries are exhausted; paid limits stay until `graceEndsAt`, then Free.
 */
export const BILLING_STATUSES = ['free', 'active', 'canceling', 'past_due', 'grace'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

/** Days a workspace keeps its paid limits after payment retries are exhausted. */
export const BILLING_GRACE_DAYS = 7;

/** Which billing backend answered. `unavailable` means no payment provider is configured. */
export type BillingMode = 'unavailable' | 'simulated' | 'provider';

export interface BillingState {
  tierId: SubscriptionTierId;
  interval: BillingInterval;
  status: BillingStatus;
  /** End of the paid period. Null on Free. */
  periodEndsAt: string | null;
  /** Set only while `status` is `grace`. */
  graceEndsAt: string | null;
  /** A downgrade waiting for the end of the period. */
  scheduledTierId: SubscriptionTierId | null;
}

export interface LimitUsage {
  used: number;
  /** `null` means unlimited. */
  limit: number | null;
  /** Items beyond the limit. They are kept and locked, never deleted. */
  lockedIds: string[];
}

export interface BillingUsage {
  apps: LimitUsage;
  connections: LimitUsage;
  teamWorkspaces: { used: number; limit: number | null };
  teamMembers: { used: number; limit: number | null };
}

export interface BillingSnapshot {
  mode: BillingMode;
  workspaceId: string;
  workspaceKind: Workspace['kind'];
  /** Only the owner can change the plan; members see it read-only. */
  canManage: boolean;
  state: BillingState;
  usage: BillingUsage;
}

export type BillingCommand =
  | { action: 'change'; tierId: SubscriptionTierId; interval: BillingInterval }
  | { action: 'cancel' }
  | { action: 'resume' };

/** Test-only state changes, accepted only by the billing simulator. */
export const BILLING_SIMULATIONS = ['payment_failed', 'retries_exhausted', 'grace_expired', 'payment_recovered', 'period_ended'] as const;
export type BillingSimulation = (typeof BILLING_SIMULATIONS)[number];

export type BillingCommandResult =
  | { ok: true; snapshot: BillingSnapshot }
  | { ok: false; code: 'unavailable' | 'forbidden' | 'invalid' | 'sales_led' | 'no_change' };

const UNLIMITED = 999;

export function planLimit(value: number): number | null {
  return value >= UNLIMITED ? null : value;
}

/** -1 downgrade, 0 same tier, 1 upgrade, by catalog order. */
export function compareTiers(from: SubscriptionTierId, to: SubscriptionTierId): -1 | 0 | 1 {
  const order = SUBSCRIPTION_PLANS.map((plan) => plan.id);
  const delta = order.indexOf(to) - order.indexOf(from);
  return delta === 0 ? 0 : delta > 0 ? 1 : -1;
}

export function planPrice(plan: SubscriptionPlan, interval: BillingInterval): number {
  return interval === 'year' ? plan.priceYearly : plan.priceMonthly;
}

/** The tier whose limits apply right now: paid limits hold through `canceling`, `past_due` and `grace`. */
export function effectiveTier(state: BillingState): SubscriptionTierId {
  return state.status === 'free' ? 'free' : state.tierId;
}

function limitUsage(ids: readonly string[], limit: number): LimitUsage {
  const max = planLimit(limit);
  return { used: ids.length, limit: max, lockedIds: max === null ? [] : ids.slice(max) };
}

/**
 * What a workspace uses against a plan. Items past a limit are reported as
 * locked in selection order (the newest are locked first); nothing is removed.
 */
export function billingUsage(
  workspace: Pick<Workspace, 'selectedAppIds' | 'connectedApps' | 'memberIds'>,
  plan: SubscriptionPlan,
  teamWorkspaceCount: number,
): BillingUsage {
  const optionalApps = workspace.selectedAppIds.filter((id) => !isAlwaysAvailableApp(APP_CATALOG, id));
  return {
    apps: limitUsage(optionalApps, plan.maxApps),
    connections: limitUsage(workspace.connectedApps.map((connection) => connection.id), plan.maxConnections),
    teamWorkspaces: { used: teamWorkspaceCount, limit: plan.allowsTeamWorkspace ? planLimit(plan.maxTeamWorkspaces) : 0 },
    teamMembers: { used: workspace.memberIds.length, limit: plan.allowsTeamWorkspace ? planLimit(plan.maxTeamMembers) : 0 },
  };
}

export function isBillingCommand(input: unknown): input is BillingCommand {
  if (!input || typeof input !== 'object') return false;
  const body = input as Record<string, unknown>;
  if (body.action === 'cancel' || body.action === 'resume') return Object.keys(body).length === 1;
  return (
    body.action === 'change' &&
    SUBSCRIPTION_PLANS.some((plan) => plan.id === body.tierId) &&
    BILLING_INTERVALS.includes(body.interval as BillingInterval) &&
    Object.keys(body).length === 3
  );
}

export function isBillingSimulation(value: unknown): value is BillingSimulation {
  return typeof value === 'string' && (BILLING_SIMULATIONS as readonly string[]).includes(value);
}
