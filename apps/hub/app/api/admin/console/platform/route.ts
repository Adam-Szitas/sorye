import { adminAccess, adminDenied, adminNoStore } from '@/lib/admin/access';
import { accessPolicy, backendStatus, deliveryRows, integrationRows } from '@/lib/admin/platform-status';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Integration, delivery and backend status. Configured flags and hostnames only; never secret values. */
export async function GET() {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  const { session } = access.actor;
  const backend = await backendStatus({ userId: session.user.id, workspaceId: session.workspace.id });
  return NextResponse.json({
    access: accessPolicy(),
    integrations: integrationRows(),
    delivery: deliveryRows(),
    backend,
    checkedAt: new Date().toISOString(),
  }, { headers: adminNoStore });
}
