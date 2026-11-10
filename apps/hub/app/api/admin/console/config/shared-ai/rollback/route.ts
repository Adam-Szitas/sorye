import {
  adminAccess,
  adminDenied,
  adminNoStore,
  adminRateLimited,
  adminWriteLimited,
  readAdminJson,
} from '@/lib/admin/access';
import { rollbackSharedAi } from '@/lib/admin/shared-ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const rollbackSchema = z.object({
  changeId: z.string().uuid(),
  expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
  targetRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
  reason: z.string().trim().max(200).optional(),
}).strict();

/** Rollback writes a new revision copying an older value; history is never rewritten. */
export async function POST(req: Request) {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  if (adminWriteLimited(access.actor.actorId)) return adminRateLimited();
  const parsed = rollbackSchema.safeParse(await readAdminJson(req));
  if (!parsed.success || parsed.data.targetRevision >= parsed.data.expectedRevision) {
    return NextResponse.json({ error: 'invalid_rollback' }, { status: 400, headers: adminNoStore });
  }
  const result = await rollbackSharedAi(access.actor, { ...parsed.data, reason: parsed.data.reason || undefined });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...(result.detail ? { detail: result.detail } : {}) }, { status: result.httpStatus, headers: adminNoStore });
  }
  return NextResponse.json(result, { headers: { ...adminNoStore, ETag: `"shared-ai-${result.revision}"` } });
}
