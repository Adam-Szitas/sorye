export type SubscriptionTierId = 'free' | 'starter' | 'pro' | 'enterprise';

export type SubscriptionSource = 'admin' | 'stripe';

export interface SubscriptionPlan {
  id: SubscriptionTierId;
  name: string;
  description: string;
  maxApps: number;
  maxConnections: number;
  priceMonthly: number;
  accent: string;
  /** Personal workspace only */
  allowsTeamWorkspace: boolean;
  maxTeamWorkspaces: number;
  maxTeamMembers: number;
  /** Stripe Price ID — wire up when billing goes live */
  stripePriceId?: string;
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Personal workspace with essential tools.',
    maxApps: 2,
    maxConnections: 1,
    priceMonthly: 0,
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
    accent: '#38bdf8',
    allowsTeamWorkspace: false,
    maxTeamWorkspaces: 0,
    maxTeamMembers: 0,
    stripePriceId: 'price_starter_placeholder',
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Personal + team workspace for small groups.',
    maxApps: 12,
    maxConnections: 10,
    priceMonthly: 49,
    accent: '#a78bfa',
    allowsTeamWorkspace: true,
    maxTeamWorkspaces: 1,
    maxTeamMembers: 5,
    stripePriceId: 'price_pro_placeholder',
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited apps, teams, and custom connectors.',
    maxApps: 999,
    maxConnections: 999,
    priceMonthly: 199,
    accent: '#f472b6',
    allowsTeamWorkspace: true,
    maxTeamWorkspaces: 999,
    maxTeamMembers: 999,
    stripePriceId: 'price_enterprise_placeholder',
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
