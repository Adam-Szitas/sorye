import { createHash } from 'node:crypto';
import type { WorkspaceNotification } from '@sorye/types';
import { upsertWorkspaceNotification } from '@/lib/notifications';

/**
 * Drive upload notices for the member who uploaded. They are addressed with
 * `userId` (not `actorId`), so the uploader sees them even though they caused them.
 *
 * - Success: one row per browser batch, updated as each file is stored.
 * - Failure: one row per failed file, carrying the queue item id so the
 *   notice can retry that exact file while the browser still holds it.
 */

const QUEUE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Queue ids are browser-generated UUIDs; anything else is ignored. */
export function parseQueueId(raw: unknown): string | undefined {
  return typeof raw === 'string' && QUEUE_ID_RE.test(raw.trim()) ? raw.trim().toLowerCase() : undefined;
}

/** Notice ids are derived from the member and queue id, so one member cannot overwrite another member's row. */
function noticeId(kind: 'b' | 'f', userId: string, queueId: string): string {
  return `ntf-up${kind}-${createHash('sha256').update(`${userId}:${queueId}`).digest('hex').slice(0, 20)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function noteUploadStored(input: {
  workspaceId: string;
  userId: string;
  batchId: string;
  fileName: string;
  size: number;
}): Promise<WorkspaceNotification> {
  return upsertWorkspaceNotification({
    workspaceId: input.workspaceId,
    id: noticeId('b', input.userId, input.batchId),
    build: (existing) => {
      const sameOwner = existing?.userId === input.userId;
      const stored = (sameOwner ? existing?.upload?.stored ?? 0 : 0) + 1;
      const bytes = (sameOwner ? existing?.upload?.bytes ?? 0 : 0) + input.size;
      return {
        userId: input.userId,
        appId: 'files',
        outcome: 'success',
        title: stored === 1 ? 'File uploaded to Drive' : `${stored} files uploaded to Drive`,
        body: stored === 1 ? `${input.fileName} (${formatBytes(bytes)})` : `Latest: ${input.fileName} · ${formatBytes(bytes)} in total`,
        upload: { batchId: input.batchId, stored, bytes, fileName: input.fileName },
      };
    },
  });
}

export async function noteUploadFailed(input: {
  workspaceId: string;
  userId: string;
  uploadId: string;
  batchId?: string;
  fileName: string;
  reason: string;
  corrupted: boolean;
}): Promise<WorkspaceNotification> {
  return upsertWorkspaceNotification({
    workspaceId: input.workspaceId,
    id: noticeId('f', input.userId, input.uploadId),
    build: () => ({
      userId: input.userId,
      appId: 'files',
      outcome: 'failure',
      title: input.corrupted ? `${input.fileName} arrived damaged — upload it again` : `${input.fileName} was not uploaded`,
      body: input.reason,
      upload: {
        uploadId: input.uploadId,
        ...(input.batchId ? { batchId: input.batchId } : {}),
        fileName: input.fileName,
        corrupted: input.corrupted,
      },
    }),
  });
}

/** Client-reported failures (the request never reached the upload route) are bounded per member. */
const reportWindowMs = 60_000;
const reportLimit = 30;
const reportsKey = Symbol.for('sorye.upload.failure-reports');
const reportState = globalThis as typeof globalThis & { [reportsKey]?: Map<string, number[]> };
const reports: Map<string, number[]> = (reportState[reportsKey] ??= new Map<string, number[]>());

export function allowClientFailureReport(userId: string, now = Date.now()): boolean {
  const recent = (reports.get(userId) ?? []).filter((at) => now - at < reportWindowMs);
  if (recent.length >= reportLimit) { reports.set(userId, recent); return false; }
  recent.push(now);
  reports.set(userId, recent);
  if (reports.size > 5_000) for (const [key, list] of reports) if (!list.some((at) => now - at < reportWindowMs)) reports.delete(key);
  return true;
}
