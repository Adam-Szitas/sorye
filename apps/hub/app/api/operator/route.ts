import { ensureHubUser } from '@/lib/ensure-user';
import { operatorDenial } from '@/lib/operator/access';
import { buildOperatorSnapshot } from '@/lib/operator/snapshot';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await ensureHubUser();
  const denied = operatorDenial(session?.user ?? null);
  if (denied || !session) {
    return NextResponse.json(denied?.body ?? { error: 'Unauthorized' }, {
      status: denied?.status ?? 401,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const snapshot = await buildOperatorSnapshot({
    userId: session.user.id,
    workspaceId: session.workspace.id,
  });
  return NextResponse.json(snapshot, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
