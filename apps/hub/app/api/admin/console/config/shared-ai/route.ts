import {
  adminAccess,
  adminDenied,
  adminNoStore,
  adminRateLimited,
  adminWriteLimited,
  readAdminJson,
} from '@/lib/admin/access';
import { readSharedAi, validateSharedAiValue, writeSharedAi } from '@/lib/admin/shared-ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const writeSchema = z.object({
  changeId: z.string().uuid(),
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  value: z.unknown(),
  reason: z.string().trim().max(200).optional(),
}).strict();

export async function GET() {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  const view = await readSharedAi(access.actor);
  return NextResponse.json(view, { headers: { ...adminNoStore, ETag: `"shared-ai-${view.revision}"` } });
}

export async function PUT(req: Request) {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  if (adminWriteLimited(access.actor.actorId)) return adminRateLimited();
  const parsed = writeSchema.safeParse(await readAdminJson(req));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', detail: parsed.error.issues[0]?.path.join('.') ?? 'body' }, { status: 400, headers: adminNoStore });
  }
  const ifMatch = req.headers.get('if-match');
  if (ifMatch !== null && ifMatch !== `"shared-ai-${parsed.data.expectedRevision}"`) {
    return NextResponse.json({ error: 'precondition_mismatch', detail: 'If-Match and expectedRevision disagree.' }, { status: 412, headers: adminNoStore });
  }
  const value = validateSharedAiValue(parsed.data.value);
  if (!value.ok) {
    return NextResponse.json({ error: 'invalid_config', detail: value.detail }, { status: 400, headers: adminNoStore });
  }
  const result = await writeSharedAi(access.actor, {
    changeId: parsed.data.changeId,
    expectedRevision: parsed.data.expectedRevision,
    value: value.value,
    reason: parsed.data.reason || undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, ...(result.detail ? { detail: result.detail } : {}) }, { status: result.httpStatus, headers: adminNoStore });
  }
  return NextResponse.json(result, { headers: { ...adminNoStore, ETag: `"shared-ai-${result.revision}"` } });
}
