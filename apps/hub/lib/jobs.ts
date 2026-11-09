import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '@sorye/db';
import { backgroundJobs as jobs } from '@sorye/db/schema';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { notifyFinishedBackgroundJob, type FinishedBackgroundJob } from '@/lib/job-finished';
import { analysisIdFromJob } from '@/lib/job-finished-notice';

export type Job = typeof jobs.$inferSelect;
export class QueueFullError extends Error {}
export class JobWorkerUnavailableError extends Error {}
export function jobId(workspaceId: string, userId: string, kind: string, key: string) {
  return createHash('sha256').update(JSON.stringify([workspaceId, userId, kind, key])).digest('hex');
}
export async function enqueueJob(input: {
  workspaceId: string; userId: string; kind: 'ocr' | 'relay'; key: string; payload: Record<string, unknown>;
}) {
  const id = jobId(input.workspaceId, input.userId, input.kind, input.key);
  return getDb().transaction(async tx => {
    // Submission admission is shared across all replicas and includes queued/running work.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sorye:job:admission'))`);
    const [existing] = await tx.select().from(jobs).where(eq(jobs.id, id));
    if (existing) return existing;
    const [count] = await tx.select({ total: sql<number>`count(*)::int`,
      mine: sql<number>`count(*) filter (where ${jobs.workspaceId} = ${input.workspaceId})::int` })
      .from(jobs).where(sql`${jobs.status} in ('queued', 'running')`);
    if (count && (count.total >= 1000 || count.mine >= 50)) throw new QueueFullError('Job queue is full. Please retry later.');
    const [created] = await tx.insert(jobs).values({ id, workspaceId: input.workspaceId, userId: input.userId,
      kind: input.kind, payload: input.payload }).returning();
    return created!;
  });
}

export async function hasLiveWorker(kind: 'ocr'): Promise<boolean> {
  const [worker] = await getDb().select({ id: jobs.id }).from(jobs).where(and(
    eq(jobs.kind, `${kind}-worker`), eq(jobs.status, 'running'), gt(jobs.leaseUntil, new Date()),
  )).limit(1);
  return Boolean(worker);
}

export async function setWorkerHeartbeat(id: string, active: boolean): Promise<void> {
  const now = new Date();
  await getDb().insert(jobs).values({
    id, workspaceId: '@system', userId: id, kind: 'ocr-worker', status: active ? 'running' : 'completed',
    payload: {}, result: null, availableAt: now, leaseUntil: active ? new Date(now.getTime() + 30_000) : null,
    finishedAt: active ? null : now,
  }).onConflictDoUpdate({
    target: jobs.id,
    set: { status: active ? 'running' : 'completed', leaseUntil: active ? new Date(now.getTime() + 30_000) : null,
      finishedAt: active ? null : now },
  });
}

export async function getJob(workspaceId: string, id: string) {
  const [job] = await getDb().select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.workspaceId, workspaceId)));
  return job ?? null;
}

function resultRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Array<Record<string, unknown>> }).rows;
  }
  return [];
}

function textColumn(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function objectColumn(row: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = row[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return null;
}

async function notifyTerminal(job: FinishedBackgroundJob): Promise<void> {
  try {
    await notifyFinishedBackgroundJob(job);
  } catch (err) {
    console.error('[jobs] finish notice failed', err instanceof Error ? err.message : 'unknown error');
  }
}

export async function claimJob(kind: 'ocr' | 'relay'): Promise<Job | null> {
  const owner = randomUUID();
  const claimed = await getDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sorye:job:${kind}`}))`);
    const failed = await tx.execute(sql`update background_jobs set status = 'failed', error = 'Worker retry limit reached', finished_at = now()
      where kind = ${kind} and attempts >= 5 and (status = 'queued' or (status = 'running' and lease_until < now()))
      returning id, workspace_id, user_id, kind, payload, result, error`);
    const [running] = await tx.select({ count: sql<number>`count(*)::int` }).from(jobs)
      .where(sql`${jobs.kind} = ${kind} and ${jobs.status} = 'running' and ${jobs.leaseUntil} > now()`);
    if ((running?.count ?? 0) >= (kind === 'ocr' ? 1 : 4)) return { job: null, failed: resultRows(failed) };
    // Workspaces least recently serviced go first; one GPU job may run across the entire fleet.
    const candidates = await tx.execute(sql`select id from background_jobs j where kind = ${kind} and attempts < 5
      and ((status = 'queued' and available_at <= now()) or (status = 'running' and lease_until < now()))
      order by (select max(started_at) from background_jobs p where p.workspace_id = j.workspace_id and p.kind = j.kind) nulls first,
        created_at, id limit 1 for update skip locked`);
    if (!candidates[0]) return { job: null, failed: resultRows(failed) };
    const [job] = await tx.update(jobs).set({ status: 'running', leaseOwner: owner,
      leaseUntil: sql`now() + interval '90 seconds'`, startedAt: new Date(), attempts: sql`${jobs.attempts} + 1` })
      .where(eq(jobs.id, String(candidates[0].id))).returning();
    return { job: job!, failed: resultRows(failed) };
  });
  for (const row of claimed.failed) {
    await notifyTerminal({
      id: textColumn(row, 'id'),
      workspaceId: textColumn(row, 'workspace_id', 'workspaceId'),
      userId: textColumn(row, 'user_id', 'userId'),
      kind: textColumn(row, 'kind'),
      status: 'failed',
      payload: objectColumn(row, 'payload') ?? {},
      result: objectColumn(row, 'result'),
      error: textColumn(row, 'error') || 'Worker retry limit reached',
    });
  }
  return claimed.job;
}

export async function heartbeatJob(job: Job): Promise<boolean> {
  const rows = await getDb().update(jobs).set({ leaseUntil: sql`now() + interval '90 seconds'` })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, 'running'), eq(jobs.leaseOwner, job.leaseOwner!))).returning({ id: jobs.id });
  return rows.length > 0;
}

export async function updateJobProgress(job: Job, progress: Record<string, unknown>): Promise<boolean> {
  const rows = await getDb().update(jobs).set({
    result: sql`coalesce(${jobs.result}, '{}'::jsonb) || ${JSON.stringify(progress)}::jsonb`,
  }).where(and(eq(jobs.id, job.id), eq(jobs.status, 'running'), eq(jobs.leaseOwner, job.leaseOwner!)))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export async function finishJob(job: Job, result: Record<string, unknown>) {
  const rows = await getDb().update(jobs).set({ status: 'completed', result, finishedAt: new Date(), leaseUntil: null })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, 'running'), eq(jobs.leaseOwner, job.leaseOwner!)))
    .returning({ id: jobs.id });
  if (rows.length > 0) {
    await notifyTerminal({
      id: job.id,
      workspaceId: job.workspaceId,
      userId: job.userId,
      kind: job.kind,
      status: 'completed',
      payload: job.payload,
      result,
      error: null,
    });
  }
  return rows.length > 0;
}

export async function retryJob(job: Job) {
  const terminal = job.attempts >= 5;
  const error = terminal
    ? 'Processing failed after repeated attempts. Retry from the source app.'
    : 'Processing will retry shortly.';
  const rows = await getDb().update(jobs).set({ status: terminal ? 'failed' : 'queued',
    error,
    availableAt: new Date(Date.now() + Math.min(300_000, 1000 * 2 ** job.attempts) + Math.random() * 1000),
    finishedAt: terminal ? new Date() : null, leaseUntil: null })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, 'running'), eq(jobs.leaseOwner, job.leaseOwner!)))
    .returning({ id: jobs.id });
  if (terminal && rows.length > 0) {
    await notifyTerminal({
      id: job.id,
      workspaceId: job.workspaceId,
      userId: job.userId,
      kind: job.kind,
      status: 'failed',
      payload: job.payload,
      result: job.result,
      error,
    });
  }
}

export async function latestRelevantOcrJob(workspaceId: string, userId: string): Promise<Job | null> {
  const rows = await getDb().select().from(jobs).where(and(
    eq(jobs.workspaceId, workspaceId), eq(jobs.userId, userId), eq(jobs.kind, 'ocr'),
  )).orderBy(desc(jobs.createdAt)).limit(5);
  return rows.find((job) => job.status === 'queued' || job.status === 'running') ?? rows[0] ?? null;
}

export function ocrResumeSummary(job: Job | null): {
  id: string;
  status: string;
  error: string | null;
  analysisId: string | null;
  presented: boolean;
} | null {
  if (!job || job.kind !== 'ocr') return null;
  const presented = job.result?.presented === true;
  const live = job.status === 'queued' || job.status === 'running';
  const terminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
  if (!live && (!terminal || presented)) return null;
  return {
    id: job.id,
    status: job.status,
    error: job.error,
    analysisId: analysisIdFromJob(job) ?? null,
    presented,
  };
}

export async function acknowledgeOcrJob(workspaceId: string, userId: string, id: string): Promise<boolean> {
  const job = await getJob(workspaceId, id);
  if (!job || job.userId !== userId || job.kind !== 'ocr') return false;
  if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') return false;
  await getDb().update(jobs).set({
    result: sql`coalesce(${jobs.result}, '{}'::jsonb) || '{"presented":true}'::jsonb`,
  }).where(and(eq(jobs.id, id), eq(jobs.workspaceId, workspaceId), eq(jobs.userId, userId)));
  return true;
}

export async function cancelJob(workspaceId: string, id: string) {
  await getDb().update(jobs).set({ status: 'cancelled', finishedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.workspaceId, workspaceId), sql`${jobs.status} in ('queued', 'running')`));
}
