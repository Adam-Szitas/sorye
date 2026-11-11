import type { HubSession, OwnStorageErrorCode, OwnStorageResult } from '@sorye/types';
import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { assertRateLimit } from '@/lib/mail-rate-limit';
import { ownStorageResult } from './service';

export const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } as const;

const STATUS: Record<OwnStorageErrorCode, number> = {
  invalid_input: 400, host_not_allowed: 400, host_unresolved: 400, unreachable: 502, tls_failed: 502,
  auth_failed: 400, not_found: 400, permission_denied: 400, timeout: 504, encryption_unavailable: 503,
  not_eligible: 403, not_owner: 403, quota_exceeded: 413, storage_unavailable: 502, integrity_failed: 502,
  target_not_ready: 409, in_use: 409, rate_limited: 429, unknown: 500,
};

/** Largest accepted request body (a CA bundle is the biggest field). */
const MAX_BODY_BYTES = 24_000;

export function resultResponse(result: OwnStorageResult): NextResponse {
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS[result.code], headers: noStore });
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  const text = await req.text().catch(() => '');
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    const value: unknown = JSON.parse(text || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Shared shape of every own-storage write: signed-in session, per-user
 * rate limit, then the action. The workspace always comes from the session.
 */
export async function ownStorageWrite(
  bucket: string,
  limit: number,
  action: (session: HubSession) => Promise<void>,
): Promise<NextResponse> {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  try {
    assertRateLimit(`own-storage:${bucket}:${session.workspace.id}:${session.user.id}`, limit, 10 * 60_000, 'rate_limited');
  } catch {
    return resultResponse({ ok: false, code: 'rate_limited' });
  }
  return resultResponse(await ownStorageResult(session, () => action(session)));
}
