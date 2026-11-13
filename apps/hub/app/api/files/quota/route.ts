import { ensureHubUser } from '@/lib/ensure-user';
import { getFileQuota } from '@/lib/files';
import { quotaLimits, readUploadThrottleConfig } from '@/lib/upload-throttle';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/** Drive limits and usage of the session's workspace, for the Hub upload manager. */
export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const quota = await getFileQuota(session.workspace.id, quotaLimits(readUploadThrottleConfig()));
    return NextResponse.json({ quota, workspaceId: session.workspace.id }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Could not read Drive usage' }, { status: 503 });
  }
}
