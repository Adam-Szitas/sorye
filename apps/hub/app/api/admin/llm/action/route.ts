import {
  adminAccess,
  adminDenied,
  adminNoStore,
  adminRateLimited,
  adminWriteLimited,
  readAdminJson,
} from '@/lib/admin/access';
import { AdminAuditUnavailableError, auditedAdminAction } from '@/lib/admin/audit';
import { getLlmControlSettings, initializeLlmControl } from '@/lib/llm-control';
import { stopLlmRuntime } from '@/lib/ocr/llm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pause and resume are `paused` in the shared-ai configuration (PUT
 * /api/admin/console/config/shared-ai). Stop is a Hub-process action: abort this
 * Hub's in-flight model requests and ask Ollama to unload. It does not cancel
 * requests already running in the separate OCR worker.
 */
export async function POST(req: Request) {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  if (adminWriteLimited(access.actor.actorId)) return adminRateLimited();
  const parsed = z.object({ action: z.literal('stop') }).strict().safeParse(await readAdminJson(req, 1024));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_action', detail: 'Only stop is an action; pause and resume are configuration.' }, { status: 400, headers: adminNoStore });
  }
  await initializeLlmControl();
  if (!getLlmControlSettings().paused) {
    return NextResponse.json({ error: 'pause_first', detail: 'Pause shared AI and wait for Hub to apply it before stopping.' }, { status: 409, headers: adminNoStore });
  }
  try {
    const audited = await auditedAdminAction(access.actor, {
      action: 'shared_ai.runtime.stop',
      targetType: 'runtime',
      targetId: 'hub',
    }, async () => {
      const result = await stopLlmRuntime();
      return { outcome: result.unloaded ? 'succeeded' : 'failed', result, details: { unloaded: result.unloaded } };
    });
    return NextResponse.json({
      ...audited.result,
      scope: 'hub-process',
      correlationId: audited.correlationId,
      auditOutcomeRecorded: audited.outcomeRecorded,
    }, { headers: adminNoStore });
  } catch (error) {
    if (error instanceof AdminAuditUnavailableError) {
      return NextResponse.json({ error: 'audit_unavailable' }, { status: 503, headers: adminNoStore });
    }
    throw error;
  }
}
