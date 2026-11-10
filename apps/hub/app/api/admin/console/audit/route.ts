import { adminAccess, adminDenied, adminNoStore } from '@/lib/admin/access';
import { rodrigoConfigured } from '@/lib/platform-config/watcher';
import { listPlatformAudit } from '@/lib/rodrigo/platform-client';
import { RodrigoResponseError } from '@/lib/rodrigo/service-client';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  if (!rodrigoConfigured()) {
    return NextResponse.json({ error: 'audit_store_not_configured' }, { status: 503, headers: adminNoStore });
  }
  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '50') || 50));
  if (cursor !== undefined && !/^(?:[0-9a-f]{2}){1,128}$/.test(cursor)) {
    return NextResponse.json({ error: 'invalid_cursor' }, { status: 400, headers: adminNoStore });
  }
  try {
    const page = await listPlatformAudit(access.actor.actorId, limit, cursor);
    return NextResponse.json(page, { headers: adminNoStore });
  } catch (error) {
    const code = error instanceof RodrigoResponseError ? error.code : 'audit_store_unavailable';
    return NextResponse.json({ error: code }, { status: 503, headers: adminNoStore });
  }
}
