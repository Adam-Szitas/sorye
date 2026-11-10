import { auth } from '@/auth';
import { isAuthDevBypass } from '@/lib/auth-dev-bypass';
import { ensureHubUser } from '@/lib/ensure-user';
import { operatorDenial } from '@/lib/operator/access';
import type { HubSession } from '@sorye/types';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { cache } from 'react';
import { classifyHost, effectiveHost, hostConfig } from './hosts';

export const adminNoStore = { 'Cache-Control': 'private, no-store' } as const;

export interface AdminActor {
  session: HubSession;
  /** Stable audit identity; never an email address. */
  actorId: string;
}

export type AdminAccess =
  | { ok: true; actor: AdminActor }
  | { ok: false; status: 401 | 403 | 404; error: string };

/**
 * Server-side gate for every admin page and API. The middleware host checks are
 * routing; this is the authorization decision and must run in each handler.
 * Cached per render so the layout and page share one session lookup (and one
 * first-visit user insert).
 */
export const adminAccess = cache(async (): Promise<AdminAccess> => {
  const hdrs = await headers();
  const { host, forwarded } = effectiveHost(hdrs);
  if (classifyHost(host, { forwarded }, hostConfig()) !== 'admin') {
    return { ok: false, status: 404, error: 'admin_host_required' };
  }
  // Embed cookies are host-only to the customer hostname; refuse them here explicitly.
  const authSession = await auth();
  if (!authSession?.user?.id && !isAuthDevBypass()) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  const session = await ensureHubUser();
  const denied = operatorDenial(session?.user ?? null);
  if (denied || !session) {
    return { ok: false, status: denied?.status ?? 401, error: denied?.body.error ?? 'Unauthorized' };
  }
  return { ok: true, actor: { session, actorId: `user:${session.user.id}` } };
});

export function adminDenied(access: Extract<AdminAccess, { ok: false }>): NextResponse {
  return NextResponse.json({ error: access.error }, { status: access.status, headers: adminNoStore });
}

const WRITE_WINDOW_MS = 60_000;
const WRITE_LIMIT = 30;
const writeWindows = new Map<string, { startedAt: number; count: number }>();

/** Per-actor write budget. Process-local: Hub runs one replica (see the runbook). */
export function adminWriteLimited(actorId: string, now = Date.now()): boolean {
  const window = writeWindows.get(actorId);
  if (!window || now - window.startedAt >= WRITE_WINDOW_MS) {
    writeWindows.set(actorId, { startedAt: now, count: 1 });
    if (writeWindows.size > 1_000) {
      for (const [key, value] of writeWindows) {
        if (now - value.startedAt >= WRITE_WINDOW_MS) writeWindows.delete(key);
      }
    }
    return false;
  }
  window.count += 1;
  return window.count > WRITE_LIMIT;
}

export function adminRateLimited(): NextResponse {
  return NextResponse.json(
    { error: 'rate_limited' },
    { status: 429, headers: { ...adminNoStore, 'Retry-After': '60' } },
  );
}

/** Bounded JSON body read; refuses bodies over `limit` bytes before parsing. */
export async function readAdminJson(req: Request, limit = 16_384): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > limit) return null;
  const text = await req.text();
  if (Buffer.byteLength(text) > limit) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
