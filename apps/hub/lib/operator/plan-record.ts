import {
  SUBSCRIPTION_PLANS,
  getPlanById,
  trimWorkspaceToPlanLimits,
  type SubscriptionTierId,
  type Workspace,
  type WorkspaceKind,
} from '@sorye/types';

const TIERS = new Set<SubscriptionTierId>(SUBSCRIPTION_PLANS.map((plan) => plan.id));
const TWO_YEARS_MS = 1000 * 60 * 60 * 24 * 366 * 2;

export interface OperatorWorkspaceRecord {
  id: string;
  name: string;
  kind: WorkspaceKind;
  subscriptionId: SubscriptionTierId;
  selectedAppIds: string[];
}

/** Apply a catalog plan onto one workspace record. Unknown ids are left untouched. */
export function assignPlanInWorkspaceMap(
  workspaces: Record<string, Workspace>,
  workspaceId: string,
  subscriptionId: SubscriptionTierId,
): Workspace | null {
  const current = workspaces[workspaceId];
  if (!current || !TIERS.has(subscriptionId)) return null;
  const plan = getPlanById(SUBSCRIPTION_PLANS, subscriptionId);
  const next = trimWorkspaceToPlanLimits(
    {
      ...current,
      subscriptionId,
      subscriptionSource: 'admin',
      updatedAt: new Date().toISOString(),
    },
    plan.maxApps,
    plan.maxConnections,
  );
  workspaces[workspaceId] = next;
  return next;
}

export function isSubscriptionTier(value: string): value is SubscriptionTierId {
  return TIERS.has(value as SubscriptionTierId);
}

export interface PlanCommand {
  workspaceId: string;
  subscriptionId: SubscriptionTierId;
  effectiveAt: string | null;
  note: string | null;
  applyNow: boolean;
}

export function parsePlanCommand(input: unknown, now = Date.now()): PlanCommand | null {
  if (!input || typeof input !== 'object') return null;
  const body = input as Record<string, unknown>;
  if (typeof body.workspaceId !== 'string') return null;
  const workspaceId = body.workspaceId.trim();
  if (!workspaceId || workspaceId.length > 80 || /[\s\u0000-\u001f]/.test(workspaceId)) return null;
  if (typeof body.subscriptionId !== 'string' || !isSubscriptionTier(body.subscriptionId)) return null;
  let effectiveAt: string | null = null;
  let applyNow = true;
  if (body.effectiveAt != null && body.effectiveAt !== '') {
    if (typeof body.effectiveAt !== 'string') return null;
    const when = Date.parse(body.effectiveAt);
    if (!Number.isFinite(when)) return null;
    if (when > now + TWO_YEARS_MS || when < now - TWO_YEARS_MS) return null;
    effectiveAt = new Date(when).toISOString();
    applyNow = when <= now;
  }
  let note: string | null = null;
  if (body.note != null && body.note !== '') {
    if (typeof body.note !== 'string') return null;
    note = body.note.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!note) note = null;
  }
  return {
    workspaceId,
    subscriptionId: body.subscriptionId,
    effectiveAt: applyNow ? null : effectiveAt,
    note,
    applyNow,
  };
}
