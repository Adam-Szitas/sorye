import {
  APP_CATALOG,
  SUBSCRIPTION_PLANS,
  getPlanById,
  selectableAppCount,
  type OperatorAppLoad,
  type OperatorDashboardSnapshot,
  type OperatorUsagePoint,
  type SubscriptionTierId,
} from '@sorye/types';
import { readOperatorHealth } from '@/lib/operator/health';
import { installOperatorPersistence } from '@/lib/operator/persist';
import { listOperatorNotices } from '@/lib/operator/notices';
import { applyDuePlanSchedules, listPlanSchedules } from '@/lib/operator/schedules';
import {
  operatorActivity,
  operatorBuckets,
  operatorDropped,
  operatorErrors,
} from '@/lib/operator/sink';
import { listOperatorWorkspaces } from '@/lib/store';

function series(
  map: Record<string, { opens: number; jobs: number; errors: number; workspaces: string[] }>,
  keys: string[],
): OperatorUsagePoint[] {
  return keys.map((bucket) => {
    const point = map[bucket];
    return {
      bucket,
      opens: point?.opens ?? 0,
      jobs: point?.jobs ?? 0,
      errors: point?.errors ?? 0,
      activeWorkspaces: point?.workspaces.length ?? 0,
    };
  });
}

function hourKeys(now: Date, count: number): string[] {
  const keys: string[] = [];
  const cursor = new Date(now);
  cursor.setUTCMinutes(0, 0, 0);
  for (let i = count - 1; i >= 0; i -= 1) {
    const at = new Date(cursor.getTime() - i * 60 * 60 * 1000);
    keys.push(at.toISOString().slice(0, 13));
  }
  return keys;
}

function dayKeys(now: Date, count: number): string[] {
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    keys.push(at.toISOString().slice(0, 10));
  }
  return keys;
}

function appLoad(dayKeysInRange: string[]): OperatorAppLoad[] {
  const { days } = operatorBuckets();
  const totals = new Map<string, OperatorAppLoad & { durationSum: number }>();
  for (const key of dayKeysInRange) {
    const bucket = days[key];
    if (!bucket) continue;
    for (const [appId, app] of Object.entries(bucket.apps)) {
      const current = totals.get(appId) ?? {
        appId,
        requests: 0,
        jobs: 0,
        errors: 0,
        durationCount: 0,
        durationSum: 0,
        durationAvgMs: null,
        durationMaxMs: null,
      };
      current.requests += app.requests;
      current.jobs += app.jobs;
      current.errors += app.errors;
      current.durationCount += app.durationCount;
      current.durationSum += app.durationSum;
      current.durationAvgMs = current.durationCount > 0
        ? Math.round(current.durationSum / current.durationCount)
        : null;
      current.durationMaxMs = current.durationCount > 0
        ? Math.max(current.durationMaxMs ?? 0, app.durationMax)
        : null;
      totals.set(appId, current);
    }
  }
  return [...totals.values()]
    .map(({ durationSum: _durationSum, ...row }) => row)
    .sort((a, b) => b.requests + b.jobs - (a.requests + a.jobs) || a.appId.localeCompare(b.appId));
}

export async function buildOperatorSnapshot(input: {
  userId: string;
  workspaceId: string;
}): Promise<OperatorDashboardSnapshot> {
  await installOperatorPersistence();
  await applyDuePlanSchedules();
  const [health, workspaces, schedules, notices] = await Promise.all([
    readOperatorHealth(input),
    listOperatorWorkspaces(),
    listPlanSchedules(),
    listOperatorNotices(),
  ]);
  const names = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  const now = new Date();
  const hours = hourKeys(now, 24);
  const days = dayKeys(now, 14);
  const buckets = operatorBuckets();
  return {
    health,
    activity: operatorActivity(names).slice(0, 80),
    usage: {
      hours: series(buckets.hours, hours),
      days: series(buckets.days, days),
    },
    appLoad: appLoad(dayKeys(now, 14)),
    errors: operatorErrors().slice(0, 40),
    workspaces: workspaces.map((workspace) => {
      const plan = getPlanById(SUBSCRIPTION_PLANS, workspace.subscriptionId);
      const schedule = schedules[workspace.id] ?? null;
      return {
        id: workspace.id,
        name: workspace.name,
        kind: workspace.kind,
        subscriptionId: workspace.subscriptionId as SubscriptionTierId,
        planName: plan.name,
        maxApps: plan.maxApps,
        selectedAppCount: selectableAppCount(APP_CATALOG, workspace.selectedAppIds),
        schedule: schedule
          ? {
              subscriptionId: schedule.subscriptionId,
              effectiveAt: schedule.effectiveAt,
              note: schedule.note,
            }
          : null,
      };
    }),
    notices,
    droppedSamples: operatorDropped(),
  };
}
