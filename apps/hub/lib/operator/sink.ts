const MAX_QUEUE = 2_000;
const MAX_ACTIVITY = 120;
const MAX_ERRORS = 60;
const MAX_HOURS = 48;
const MAX_DAYS = 90;
const MAX_WORKSPACES = 150;
const MAX_COUNT = 1_000_000_000;
const MAX_DURATION_MS = 30 * 60 * 1000;

export interface OperatorSample {
  at: number;
  appId: string;
  workspaceId: string;
  workspaceName: string;
  eventName: string;
  ok: boolean;
  durationMs?: number;
  kind: 'event' | 'job';
}

export interface OperatorErrorInput {
  appId: string;
  route: string;
  message: string;
  stack?: string;
  redact?: string[];
}

interface AppBucket {
  requests: number;
  jobs: number;
  errors: number;
  durationSum: number;
  durationCount: number;
  durationMax: number;
}

interface TimeBucket {
  opens: number;
  jobs: number;
  errors: number;
  workspaces: string[];
  apps: Record<string, AppBucket>;
}

interface ActivityRow {
  at: number;
  appId: string;
  workspaceId: string;
  workspaceName: string;
  eventName: string;
  ok: boolean;
}

interface ErrorRow {
  appId: string;
  route: string;
  message: string;
  count: number;
  lastSeen: string;
  location: string | null;
}

export interface PersistedOperatorMetrics {
  hours: Record<string, TimeBucket>;
  days: Record<string, TimeBucket>;
  activity: ActivityRow[];
  errors: ErrorRow[];
}

const SECRET =
  /\b(?:bearer|authorization|cookie|set-cookie|password|secret|api[_-]?key|token)\b\s*[:=]?\s*\S+/gi;

let hours: Record<string, TimeBucket> = {};
let days: Record<string, TimeBucket> = {};
let activity: ActivityRow[] = [];
let errors: ErrorRow[] = [];
let dropped = 0;
let queue: OperatorSample[] = [];
let early: OperatorSample[] = [];
let pendingErrors: OperatorErrorInput[] = [];
let hydrated = false;
let persistReady = false;
let persistIsDefault = true;
let drainChain: Promise<void> = Promise.resolve();
let persistImpl: (state: PersistedOperatorMetrics) => Promise<void> = async () => {};

function saturate(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_COUNT, Math.floor(n));
}

function emptyBucket(): TimeBucket {
  return { opens: 0, jobs: 0, errors: 0, workspaces: [], apps: {} };
}

function cleanAppId(appId: string): string {
  const safe = appId.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  return safe || 'hub';
}

function cleanEvent(name: string): string {
  if (name === 'ocr.job') return name;
  if (/^sorye\.[a-z0-9._-]{1,80}$/.test(name)) return name;
  return 'unknown';
}

function cleanName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function cleanId(id: string): string {
  return id.replace(/[^\w:.-]/g, '').slice(0, 80);
}

function cleanRoute(route: string): string {
  const path = route.split('?')[0]?.split('#')[0] ?? '';
  const safe = path.replace(/[^a-zA-Z0-9/_:.-]/g, '').slice(0, 80);
  return safe || 'hub';
}

export function sanitizeOperatorMessage(message: string, redact: string[] = []): string {
  let text = message.replace(/[\u0000-\u001f\u007f]/g, ' ');
  for (const secret of redact) {
    if (typeof secret !== 'string' || secret.length < 12) continue;
    const step = 48;
    const limit = Math.min(secret.length, 2_000);
    for (let i = 0; i < limit; i += step) {
      const piece = secret.slice(i, i + step);
      if (piece.length >= 12) text = text.split(piece).join(' ');
    }
  }
  text = text.replace(SECRET, ' ');
  text = text.replace(/\s+/g, ' ').trim().slice(0, 180);
  return text || 'Error';
}

function locationFromStack(stack: string | undefined): string | null {
  if (!stack) return null;
  const match = stack.match(/(?:apps|packages)\/[A-Za-z0-9_./-]+:\d+(?::\d+)?/);
  return match ? match[0].slice(0, 120) : null;
}

function hourKey(at: number): string {
  return new Date(at).toISOString().slice(0, 13);
}

function dayKey(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function prune(map: Record<string, TimeBucket>, max: number): void {
  const keys = Object.keys(map).sort();
  while (keys.length > max) {
    const key = keys.shift();
    if (key) delete map[key];
  }
}

function touchApp(bucket: TimeBucket, appId: string): AppBucket {
  const current = bucket.apps[appId] ?? {
    requests: 0,
    jobs: 0,
    errors: 0,
    durationSum: 0,
    durationCount: 0,
    durationMax: 0,
  };
  bucket.apps[appId] = current;
  return current;
}

function rememberWorkspace(bucket: TimeBucket, workspaceId: string): void {
  if (!workspaceId) return;
  if (bucket.workspaces.includes(workspaceId)) return;
  if (bucket.workspaces.length >= MAX_WORKSPACES) return;
  bucket.workspaces.push(workspaceId);
}

function applySample(sample: OperatorSample): void {
  const at = Number.isFinite(sample.at) ? sample.at : Date.now();
  const appId = cleanAppId(sample.appId);
  const workspaceId = cleanId(sample.workspaceId);
  const eventName = cleanEvent(sample.eventName);
  const ok = sample.ok === true;
  const hour = hours[hourKey(at)] ?? emptyBucket();
  const day = days[dayKey(at)] ?? emptyBucket();
  const appHour = touchApp(hour, appId);
  const appDay = touchApp(day, appId);
  rememberWorkspace(hour, workspaceId);
  rememberWorkspace(day, workspaceId);
  if (!ok) {
    hour.errors = saturate(hour.errors + 1);
    day.errors = saturate(day.errors + 1);
    appHour.errors = saturate(appHour.errors + 1);
    appDay.errors = saturate(appDay.errors + 1);
  }
  if (sample.kind === 'job') {
    hour.jobs = saturate(hour.jobs + 1);
    day.jobs = saturate(day.jobs + 1);
    appHour.jobs = saturate(appHour.jobs + 1);
    appDay.jobs = saturate(appDay.jobs + 1);
  } else {
    hour.opens = saturate(hour.opens + 1);
    day.opens = saturate(day.opens + 1);
    appHour.requests = saturate(appHour.requests + 1);
    appDay.requests = saturate(appDay.requests + 1);
  }
  if (typeof sample.durationMs === 'number' && sample.durationMs >= 0 && sample.durationMs <= MAX_DURATION_MS) {
    const duration = Math.round(sample.durationMs);
    for (const app of [appHour, appDay]) {
      app.durationSum = saturate(app.durationSum + duration);
      app.durationCount = saturate(app.durationCount + 1);
      app.durationMax = Math.max(app.durationMax, duration);
    }
  }
  hours[hourKey(at)] = hour;
  days[dayKey(at)] = day;
  prune(hours, MAX_HOURS);
  prune(days, MAX_DAYS);
  activity.push({
    at,
    appId,
    workspaceId,
    workspaceName: cleanName(sample.workspaceName),
    eventName,
    ok,
  });
  if (activity.length > MAX_ACTIVITY) activity.splice(0, activity.length - MAX_ACTIVITY);
}

function applyError(input: OperatorErrorInput): void {
  const message = sanitizeOperatorMessage(input.message, input.redact ?? []);
  const appId = cleanAppId(input.appId);
  const route = cleanRoute(input.route);
  const location = locationFromStack(input.stack);
  const lastSeen = new Date().toISOString();
  const existing = errors.find((row) => row.appId === appId && row.route === route && row.message === message);
  if (existing) {
    existing.count = saturate(existing.count + 1);
    existing.lastSeen = lastSeen;
    if (location) existing.location = location;
    return;
  }
  errors.push({ appId, route, message, count: 1, lastSeen, location });
  if (errors.length > MAX_ERRORS) errors.splice(0, errors.length - MAX_ERRORS);
}

function exportState(): PersistedOperatorMetrics {
  return {
    hours: structuredClone(hours),
    days: structuredClone(days),
    activity: activity.slice(),
    errors: errors.slice(),
  };
}

function schedulePersist(): void {
  const snapshot = exportState();
  void Promise.resolve()
    .then(() => persistImpl(snapshot))
    .catch(() => undefined);
}

async function drainOnce(): Promise<void> {
  const batch = queue.splice(0, 500);
  for (const sample of batch) applySample(sample);
  if (batch.length > 0) schedulePersist();
  if (queue.length > 0) drainChain = drainChain.then(() => drainOnce());
}

function enqueue(sample: OperatorSample): void {
  if (!hydrated) {
    if (early.length >= MAX_QUEUE) {
      dropped += 1;
      return;
    }
    early.push(sample);
    ensurePersist();
    return;
  }
  if (queue.length >= MAX_QUEUE) {
    dropped += 1;
    return;
  }
  queue.push(sample);
  drainChain = drainChain.then(() => drainOnce());
}

function ensurePersist(): void {
  if (persistReady) return;
  persistReady = true;
  void import('./persist')
    .then((mod) => {
      if (persistIsDefault) void mod.installOperatorPersistence();
    })
    .catch(() => undefined);
}

function boundedBucket(raw: TimeBucket | undefined): TimeBucket {
  if (!raw || typeof raw !== 'object') return emptyBucket();
  const apps: Record<string, AppBucket> = {};
  for (const [appId, app] of Object.entries(raw.apps ?? {}).slice(0, 40)) {
    apps[cleanAppId(appId)] = {
      requests: saturate(app?.requests ?? 0),
      jobs: saturate(app?.jobs ?? 0),
      errors: saturate(app?.errors ?? 0),
      durationSum: saturate(app?.durationSum ?? 0),
      durationCount: saturate(app?.durationCount ?? 0),
      durationMax: saturate(app?.durationMax ?? 0),
    };
  }
  return {
    opens: saturate(raw.opens ?? 0),
    jobs: saturate(raw.jobs ?? 0),
    errors: saturate(raw.errors ?? 0),
    workspaces: Array.isArray(raw.workspaces)
      ? raw.workspaces.filter((id) => typeof id === 'string').map(cleanId).filter(Boolean).slice(0, MAX_WORKSPACES)
      : [],
    apps,
  };
}

export function hydrateOperatorState(saved: PersistedOperatorMetrics | null): void {
  if (hydrated) return;
  hydrated = true;
  if (saved) {
    hours = {};
    days = {};
    for (const [key, bucket] of Object.entries(saved.hours ?? {})) {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(key)) hours[key] = boundedBucket(bucket);
    }
    for (const [key, bucket] of Object.entries(saved.days ?? {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) days[key] = boundedBucket(bucket);
    }
    prune(hours, MAX_HOURS);
    prune(days, MAX_DAYS);
    activity = Array.isArray(saved.activity) ? saved.activity.slice(-MAX_ACTIVITY) : [];
    errors = Array.isArray(saved.errors)
      ? saved.errors.slice(-MAX_ERRORS).map((row) => ({
          appId: cleanAppId(String(row.appId ?? '')),
          route: cleanRoute(String(row.route ?? '')),
          message: sanitizeOperatorMessage(String(row.message ?? '')),
          count: saturate(row.count ?? 0),
          lastSeen: typeof row.lastSeen === 'string' ? row.lastSeen.slice(0, 40) : new Date().toISOString(),
          location: typeof row.location === 'string' ? row.location.slice(0, 120) : null,
        }))
      : [];
  }
  const pending = early.splice(0, early.length);
  for (const sample of pending) enqueue(sample);
  const queuedErrors = pendingErrors.splice(0, pendingErrors.length);
  for (const item of queuedErrors) applyError(item);
  if (queuedErrors.length > 0) schedulePersist();
}

export function setOperatorPersist(persist: (state: PersistedOperatorMetrics) => Promise<void>): void {
  persistImpl = persist;
  persistIsDefault = false;
  persistReady = true;
}

/** Returns immediately. The sink drains and persists later, and drops when full. */
export function noteOperatorSample(sample: OperatorSample): void {
  enqueue(sample);
}

export function noteOperatorError(input: OperatorErrorInput): void {
  if (!hydrated) {
    pendingErrors.push(input);
    if (pendingErrors.length > MAX_ERRORS) pendingErrors.shift();
    ensurePersist();
    return;
  }
  applyError(input);
  schedulePersist();
}

function longStrings(value: unknown, into: string[], budget: { n: number }, depth: number): void {
  if (budget.n <= 0 || depth > 4 || value == null) return;
  if (typeof value === 'string') {
    if (value.length >= 24) {
      into.push(value.slice(0, 500));
      if (value.length > 500) into.push(value.slice(-200));
      budget.n -= 1;
    }
    return;
  }
  if (typeof value !== 'object') return;
  const entries = Array.isArray(value) ? value.slice(0, 12) : Object.values(value).slice(0, 12);
  for (const entry of entries) longStrings(entry, into, budget, depth + 1);
}

export function noteFinishedOperatorJob(job: {
  kind: string;
  status: string;
  workspaceId: string;
  error: string | null;
  result: Record<string, unknown> | null;
  payload: Record<string, unknown>;
}): void {
  if (job.kind !== 'ocr' || !job.workspaceId || job.workspaceId === '@system') return;
  const duration = job.result && typeof job.result.durationMs === 'number' ? job.result.durationMs : undefined;
  noteOperatorSample({
    at: Date.now(),
    appId: 'ocr',
    workspaceId: job.workspaceId,
    workspaceName: '',
    eventName: 'ocr.job',
    ok: job.status === 'completed',
    durationMs: duration,
    kind: 'job',
  });
  if (job.status !== 'failed') return;
  const redact: string[] = [];
  longStrings(job.payload, redact, { n: 12 }, 0);
  longStrings(job.result, redact, { n: 12 }, 0);
  noteOperatorError({
    appId: 'ocr',
    route: 'worker:ocr',
    message: job.error ?? 'OCR job failed',
    redact,
  });
}

export function operatorActivity(names: Map<string, string>): Array<{
  appId: string;
  eventName: string;
  at: string;
  workspaceName: string;
  ok: boolean;
}> {
  return activity.slice().reverse().map((row) => ({
    appId: row.appId,
    eventName: row.eventName,
    at: new Date(row.at).toISOString(),
    workspaceName: row.workspaceName || names.get(row.workspaceId) || 'Workspace',
    ok: row.ok,
  }));
}

export function operatorErrors(): ErrorRow[] {
  return errors.slice().reverse();
}

export function operatorDropped(): number {
  return dropped;
}

export function operatorBuckets(): { hours: Record<string, TimeBucket>; days: Record<string, TimeBucket> } {
  return { hours, days };
}

export function flushOperatorSinkForTests(): Promise<void> {
  return drainChain;
}

export function configureOperatorSinkForTests(options: {
  persist: (state: PersistedOperatorMetrics) => Promise<void>;
}): void {
  hours = {};
  days = {};
  activity = [];
  errors = [];
  dropped = 0;
  queue = [];
  early = [];
  pendingErrors = [];
  hydrated = true;
  persistReady = true;
  persistIsDefault = false;
  persistImpl = options.persist;
  drainChain = Promise.resolve();
}

export function readOperatorErrorsForTests(): ErrorRow[] {
  return errors.slice();
}
