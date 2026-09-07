import {
  APP_CATALOG,
  DEFAULT_REPORT_RANGE_DAYS,
  MAX_REPORT_RANGE_DAYS,
  REPORT_EVENT_LABELS,
  REPORT_FUNNEL_EVENTS,
  REPORT_RANGE_DAYS,
  relaySourceFromEventName,
  type ReportNamedCount,
  type ReportRangeDays,
  type WorkspaceEventName,
  type WorkspaceReportsSnapshot,
} from '@sorye/types';
import { countFailedRelayDeliveries } from '@/lib/relay';
import { isWorkspaceEventName as isAllowlistedEventName } from '@/lib/security';
import { jsonDataFile } from '@/lib/store/json-file';

const MAX_STORED_DAYS = MAX_REPORT_RANGE_DAYS;
const MAX_CELL_COUNT = 1_000_000;

const KNOWN_APP_IDS = new Set(APP_CATALOG.map((app) => app.id));

interface DayBucket {
  total: number;
  byName: Record<string, number>;
  byApp: Record<string, number>;
  tooMuch: number;
}

interface WorkspaceReportIndex {
  days: Record<string, DayBucket>;
}

type ReportStore = Record<string, WorkspaceReportIndex>;

const statsFile = jsonDataFile<ReportStore>('report-stats.json', () => ({}));

function emptyBucket(): DayBucket {
  return { total: 0, byName: {}, byApp: {}, tooMuch: 0 };
}

function utcDayKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function addDaysUtc(dayKey: string, delta: number): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return utcDayKey(date);
}

function saturate(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_CELL_COUNT, Math.floor(n));
}

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = saturate((map[key] ?? 0) + by);
}

function pruneDays(days: Record<string, DayBucket>, today: string): void {
  const cutoff = addDaysUtc(today, -(MAX_STORED_DAYS - 1));
  for (const key of Object.keys(days)) {
    if (key < cutoff) delete days[key];
  }
}

function resolveAppId(
  name: WorkspaceEventName,
  payloadAppId: string | undefined,
): string | null {
  if (payloadAppId && KNOWN_APP_IDS.has(payloadAppId)) return payloadAppId;
  const fromName = relaySourceFromEventName(name);
  if (fromName && KNOWN_APP_IDS.has(fromName)) return fromName;
  return null;
}

export function parseReportRangeDays(raw: string | null): ReportRangeDays {
  const n = Number(raw);
  if ((REPORT_RANGE_DAYS as readonly number[]).includes(n)) {
    return n as ReportRangeDays;
  }
  return DEFAULT_REPORT_RANGE_DAYS;
}

/** Count-only index: allowlisted name + appId + UTC day. No payloads. */
export async function recordWorkspaceEventStat(input: {
  workspaceId: string;
  name: string;
  appId?: string;
  at?: Date;
}): Promise<void> {
  if (!isAllowlistedEventName(input.name)) return;
  const name = input.name;
  const at = input.at ?? new Date();
  const day = utcDayKey(at);
  const appId = resolveAppId(name, input.appId);

  await statsFile.update((store) => {
    const current = store[input.workspaceId] ?? { days: {} };
    pruneDays(current.days, day);
    const bucket = current.days[day] ?? emptyBucket();
    bucket.total = saturate(bucket.total + 1);
    bump(bucket.byName, name);
    if (appId) bump(bucket.byApp, appId);
    if (name === 'sorye.studio.too_much') {
      bucket.tooMuch = saturate(bucket.tooMuch + 1);
    }
    current.days[day] = bucket;
    store[input.workspaceId] = current;
  });
}

function isoWeekKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function appLabel(appId: string): string {
  return APP_CATALOG.find((app) => app.id === appId)?.name ?? appId;
}

function eventLabel(name: string): string {
  return REPORT_EVENT_LABELS[name as WorkspaceEventName] ?? name;
}

function namedCounts(
  totals: Record<string, number>,
  labelFor: (id: string) => string,
): ReportNamedCount[] {
  return Object.entries(totals)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([id, count]) => ({ id, label: labelFor(id), count }));
}

async function countFailedDeliveries(
  workspaceId: string,
  fromDay: string,
  toDay: string,
): Promise<number> {
  const failed = await countFailedRelayDeliveries(workspaceId, fromDay, toDay);
  return saturate(failed);
}

export async function getWorkspaceReports(
  workspaceId: string,
  rangeDays: ReportRangeDays,
  options?: { eventsEnabled?: boolean },
): Promise<WorkspaceReportsSnapshot> {
  const today = utcDayKey(new Date());
  const fromDay = addDaysUtc(today, -(rangeDays - 1));
  const store = await statsFile.read();
  const index = store[workspaceId] ?? { days: {} };

  const byName: Record<string, number> = {};
  const byApp: Record<string, number> = {};
  let events = 0;
  let tooMuch = 0;

  const daily: Array<{ bucket: string; count: number }> = [];
  for (let i = 0; i < rangeDays; i += 1) {
    const day = addDaysUtc(fromDay, i);
    const bucket = index.days[day];
    const count = bucket?.total ?? 0;
    daily.push({ bucket: day, count });
    events = saturate(events + count);
    tooMuch = saturate(tooMuch + (bucket?.tooMuch ?? 0));
    if (!bucket) continue;
    for (const [name, n] of Object.entries(bucket.byName)) {
      if (!isAllowlistedEventName(name)) continue;
      bump(byName, name, n);
    }
    for (const [appId, n] of Object.entries(bucket.byApp)) {
      if (!KNOWN_APP_IDS.has(appId)) continue;
      bump(byApp, appId, n);
    }
  }

  const granularity: WorkspaceReportsSnapshot['granularity'] =
    rangeDays >= 90 ? 'week' : 'day';
  let series = daily;
  if (granularity === 'week') {
    const weeks: Record<string, number> = {};
    const order: string[] = [];
    for (const point of daily) {
      const key = isoWeekKey(point.bucket);
      if (!(key in weeks)) {
        weeks[key] = 0;
        order.push(key);
      }
      weeks[key] = saturate(weeks[key] + point.count);
    }
    series = order.map((bucket) => ({ bucket, count: weeks[bucket] ?? 0 }));
  }

  const funnel = REPORT_FUNNEL_EVENTS.map((item) => ({
    id: item.name,
    label: item.label,
    count: byName[item.name] ?? 0,
  }));

  const failedDeliveries = await countFailedDeliveries(
    workspaceId,
    fromDay,
    today,
  );

  return {
    rangeDays,
    granularity,
    from: `${fromDay}T00:00:00.000Z`,
    to: `${today}T23:59:59.999Z`,
    eventsEnabled: options?.eventsEnabled === true,
    totals: {
      events,
      tooMuch,
      failedDeliveries,
    },
    series,
    byApp: namedCounts(byApp, appLabel),
    byName: namedCounts(byName, eventLabel),
    funnel,
  };
}
