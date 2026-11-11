import {
  SUBSCRIPTION_PLANS,
  billingUsage,
  effectiveTier,
  getPlanById,
  type BillingCommand,
  type BillingCommandResult,
  type BillingMode,
  type BillingSimulation,
  type BillingSnapshot,
  type BillingState,
  type HubSession,
  type SubscriptionTierId,
} from '@sorye/types';
import { getEnv } from '@/lib/env';
import { applyCommand, applySimulation } from '@/lib/billing/transitions';
import { jsonDataFile } from '@/lib/store/json-file';
import { setWorkspaceTier } from '@/lib/store';

/**
 * Self-service billing for the active workspace.
 *
 * No payment provider is wired yet, so the default mode is `unavailable`: the
 * page shows plans and sends people to sales. With BILLING_SIMULATOR=true
 * (never in production; env.ts rejects it) the simulator below stands in for a
 * provider so every flow can be tested end to end. A real provider adapter
 * replaces the simulator and reports state through signed webhooks; see
 * docs/SUBSCRIPTIONS.md.
 */

export function billingMode(): BillingMode {
  const env = getEnv();
  return env.BILLING_SIMULATOR === 'true' && env.NODE_ENV !== 'production' ? 'simulated' : 'unavailable';
}

/** Simulator state, one record per workspace. Local test data only; never used in production. */
const simulatorFile = jsonDataFile<{ workspaces: Record<string, BillingState> }>('billing-simulator.json', () => ({ workspaces: {} }));

function stateFromWorkspace(tierId: SubscriptionTierId): BillingState {
  return { tierId, interval: 'month', status: tierId === 'free' ? 'free' : 'active', periodEndsAt: null, graceEndsAt: null, scheduledTierId: null };
}

function snapshotOf(session: HubSession, mode: BillingMode, state: BillingState): BillingSnapshot {
  const { workspace, user } = session;
  const plan = getPlanById(SUBSCRIPTION_PLANS, effectiveTier(state));
  return {
    mode,
    workspaceId: workspace.id,
    workspaceKind: workspace.kind,
    canManage: workspace.ownerId === user.id,
    state,
    usage: billingUsage(workspace, plan, user.teamWorkspaceIds.length),
  };
}

export async function getBillingSnapshot(session: HubSession): Promise<BillingSnapshot> {
  const mode = billingMode();
  if (mode !== 'simulated') return snapshotOf(session, mode, stateFromWorkspace(session.workspace.subscriptionId));
  const data = await simulatorFile.read();
  const state = data.workspaces[session.workspace.id] ?? stateFromWorkspace(session.workspace.subscriptionId);
  return snapshotOf(session, mode, state);
}

async function commitSimulated(session: HubSession, change: (state: BillingState) => BillingState | null): Promise<BillingCommandResult> {
  const workspaceId = session.workspace.id;
  const outcome = await simulatorFile.update((data) => {
    const current = data.workspaces[workspaceId] ?? stateFromWorkspace(session.workspace.subscriptionId);
    const next = change(current);
    if (next === null) return null;
    data.workspaces[workspaceId] = next;
    return next;
  });
  if (outcome === null) return { ok: false, code: 'no_change' };
  // The workspace record carries the tier the rest of the Hub enforces. Nothing over the limit is removed.
  const workspace = await setWorkspaceTier(workspaceId, effectiveTier(outcome));
  const fresh: HubSession = workspace ? { ...session, workspace: { ...session.workspace, subscriptionId: workspace.subscriptionId } } : session;
  return { ok: true, snapshot: snapshotOf(fresh, 'simulated', outcome) };
}

export async function runBillingCommand(session: HubSession, command: BillingCommand): Promise<BillingCommandResult> {
  if (session.workspace.ownerId !== session.user.id) return { ok: false, code: 'forbidden' };
  if (billingMode() !== 'simulated') return { ok: false, code: 'unavailable' };
  // The simulator also allows sales-led tiers so they can be tested; a real provider refuses them.
  return commitSimulated(session, (state) => applyCommand(state, command));
}

export async function runBillingSimulation(session: HubSession, event: BillingSimulation): Promise<BillingCommandResult> {
  if (billingMode() !== 'simulated') return { ok: false, code: 'unavailable' };
  if (session.workspace.ownerId !== session.user.id) return { ok: false, code: 'forbidden' };
  return commitSimulated(session, (state) => applySimulation(state, event));
}
