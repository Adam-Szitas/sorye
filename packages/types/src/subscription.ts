export type SubscriptionTierId = 'free' | 'starter' | 'pro' | 'enterprise';

export type SubscriptionSource = 'admin' | 'stripe';

/** Every list price is in this currency. Payment providers convert or tax on top. */
export const PLAN_CURRENCY = 'EUR' as const;

/** Yearly billing charges ten months: two months free. */
export const YEARLY_MONTHS_CHARGED = 10;

export interface SubscriptionPlan {
  id: SubscriptionTierId;
  name: string;
  description: string;
  maxApps: number;
  maxConnections: number;
  /** List price per month in PLAN_CURRENCY, billed monthly. */
  priceMonthly: number;
  /** List price per year in PLAN_CURRENCY, billed yearly. */
  priceYearly: number;
  /** True when the plan is sold through a conversation, not self-service checkout. */
  salesLed: boolean;
  accent: string;
  /** Personal workspace only */
  allowsTeamWorkspace: boolean;
  maxTeamWorkspaces: number;
  maxTeamMembers: number;
}

/**
 * These monthly amounts are plan caps, not the electricity bill.
 * The yearly figure that covers one running stack is
 * `APP_RUNNING_COST.yearlyCents` in `running-cost.ts`, split per app
 * by `costWeight` on the catalog.
 */

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Personal workspace with essential tools.',
    maxApps: 2,
    maxConnections: 1,
    priceMonthly: 0,
    priceYearly: 0,
    salesLed: false,
    accent: '#94a3b8',
    allowsTeamWorkspace: false,
    maxTeamWorkspaces: 0,
    maxTeamMembers: 0,
  },
  {
    id: 'starter',
    name: 'Starter',
    description: 'Solo builders with more apps and connections.',
    maxApps: 5,
    maxConnections: 3,
    priceMonthly: 19,
    priceYearly: 19 * YEARLY_MONTHS_CHARGED,
    salesLed: false,
    accent: '#38bdf8',
    allowsTeamWorkspace: false,
    maxTeamWorkspaces: 0,
    maxTeamMembers: 0,
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Personal + team workspace for small groups.',
    maxApps: 12,
    maxConnections: 10,
    priceMonthly: 49,
    priceYearly: 49 * YEARLY_MONTHS_CHARGED,
    salesLed: false,
    accent: '#a78bfa',
    allowsTeamWorkspace: true,
    maxTeamWorkspaces: 1,
    maxTeamMembers: 5,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited apps, teams, and custom connectors.',
    maxApps: 999,
    maxConnections: 999,
    /** Starting price shown on the pricing page; the contract sets the real amount. */
    priceMonthly: 199,
    priceYearly: 199 * YEARLY_MONTHS_CHARGED,
    salesLed: true,
    accent: '#f472b6',
    allowsTeamWorkspace: true,
    maxTeamWorkspaces: 999,
    maxTeamMembers: 999,
  },
];

export function getPlanById(
  plans: SubscriptionPlan[],
  id: SubscriptionTierId,
): SubscriptionPlan {
  return plans.find((plan) => plan.id === id) ?? plans[0];
}

export function canSelectMoreApps(
  plan: SubscriptionPlan,
  selectedCount: number,
): boolean {
  return selectedCount < plan.maxApps;
}

export function canAddConnection(
  plan: SubscriptionPlan,
  connectionCount: number,
): boolean {
  return connectionCount < plan.maxConnections;
}

export function canCreateTeamWorkspace(
  plan: SubscriptionPlan,
  existingTeamCount: number,
): boolean {
  return (
    plan.allowsTeamWorkspace && existingTeamCount < plan.maxTeamWorkspaces
  );
}
