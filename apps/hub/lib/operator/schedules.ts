import type { SubscriptionTierId } from '@sorye/types';
import { jsonDataFile } from '@/lib/store/json-file';
import { assignWorkspacePlan } from '@/lib/store';

export interface StoredPlanSchedule {
  subscriptionId: SubscriptionTierId;
  effectiveAt: string;
  note: string | null;
  createdAt: string;
}

type ScheduleStore = Record<string, StoredPlanSchedule>;

const MAX_SCHEDULES = 200;
const CACHE_MS = 30_000;

const file = jsonDataFile<ScheduleStore>('operator-schedules.json', () => ({}));

let cache: { at: number; map: ScheduleStore } | null = null;

async function readMap(): Promise<ScheduleStore> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.map;
  const map = await file.read();
  cache = { at: Date.now(), map };
  return map;
}

export async function listPlanSchedules(): Promise<ScheduleStore> {
  const map = await readMap();
  return { ...map };
}

export async function savePlanSchedule(
  workspaceId: string,
  schedule: Omit<StoredPlanSchedule, 'createdAt'>,
): Promise<boolean> {
  let saved = false;
  await file.update((store) => {
    if (!store[workspaceId] && Object.keys(store).length >= MAX_SCHEDULES) return;
    store[workspaceId] = { ...schedule, createdAt: new Date().toISOString() };
    cache = { at: Date.now(), map: { ...store } };
    saved = true;
  });
  return saved;
}

export async function clearPlanSchedule(workspaceId: string): Promise<void> {
  await file.update((store) => {
    delete store[workspaceId];
    cache = { at: Date.now(), map: { ...store } };
  });
}

/** Apply one due schedule. No-op when this workspace has nothing due. */
export async function applyDuePlanForWorkspace(workspaceId: string): Promise<boolean> {
  const map = await readMap();
  const schedule = map[workspaceId];
  if (!schedule) return false;
  if (Date.parse(schedule.effectiveAt) > Date.now()) return false;
  const updated = await assignWorkspacePlan(workspaceId, schedule.subscriptionId);
  await clearPlanSchedule(workspaceId);
  return Boolean(updated);
}

export async function applyDuePlanSchedules(): Promise<void> {
  const map = await readMap();
  const now = Date.now();
  for (const [workspaceId, schedule] of Object.entries(map)) {
    if (Date.parse(schedule.effectiveAt) > now) continue;
    await assignWorkspacePlan(workspaceId, schedule.subscriptionId);
    await clearPlanSchedule(workspaceId);
  }
}
