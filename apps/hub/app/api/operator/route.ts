import { adminAccess, adminDenied, adminNoStore } from '@/lib/admin/access';
import { buildOperatorSnapshot } from '@/lib/operator/snapshot';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  const { session } = access.actor;
  const snapshot = await buildOperatorSnapshot({
    userId: session.user.id,
    workspaceId: session.workspace.id,
  });
  return NextResponse.json(snapshot, { headers: adminNoStore });
}
