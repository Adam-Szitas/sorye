import { ensureHubUser } from '@/lib/ensure-user';
import { getEventSettings } from '@/lib/events';
import { isPlatformAdmin } from '@/lib/platform-admin';
import { getWorkspaceReports, parseReportRangeDays } from '@/lib/reports';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isPlatformAdmin(session.user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const rangeDays = parseReportRangeDays(url.searchParams.get('days'));
  const settings = await getEventSettings(session.workspace.id);
  const snapshot = await getWorkspaceReports(session.workspace.id, rangeDays, {
    eventsEnabled: settings.enabled === true,
  });

  return NextResponse.json(snapshot);
}
