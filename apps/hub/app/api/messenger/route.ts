import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { getWorkspaceMembers } from '@/lib/store';
import { listRodrigoResources } from '@/lib/rodrigo/service-client';
import { viewerPersonalPackageIncludes } from '@/lib/personal-package';
import { getEventSettings } from '@/lib/events';
import { EVENTS_CHANNEL_NAME, isMessengerEventsEligible, type MessengerChannel } from '@sorye/types';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('messenger')) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  if (session.workspace.kind === 'personal' && !(await viewerPersonalPackageIncludes(session, 'messenger'))) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  try {
    const context = { userId: session.user.id, workspaceId: session.workspace.id };
    const members = await getWorkspaceMembers(session.workspace.id);
    const channels: MessengerChannel[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 20; pages++) {
      const page = await listRodrigoResources(context, 'messenger', 'channel', 100, cursor);
      for (const item of page.items) {
        const raw = item.resource;
        if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.kind !== 'string') continue;
        const memberIds = Array.isArray(raw.memberIds) ? raw.memberIds.filter((id): id is string => typeof id === 'string') : [];
        const kind = raw.kind === 'direct' ? 'dm' : ['public', 'private', 'events'].includes(raw.kind) ? 'channel' : null;
        if (!kind || (kind === 'dm' || raw.kind === 'private') && !memberIds.includes(session.user.id)) continue;
        channels.push({ id: raw.id, workspaceId: session.workspace.id, kind, name: raw.name, memberIds,
          createdAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
          createdBy: item.createdByUserId ?? '' });
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    const settings = await getEventSettings(session.workspace.id);
    const eligible = isMessengerEventsEligible(session.workspace.selectedAppIds);
    return NextResponse.json({ workspace: { id: session.workspace.id, kind: session.workspace.kind, name: session.workspace.name },
      user: { id: session.user.id, name: session.user.displayName, ...(session.user.image ? { image: session.user.image } : {}) },
      members, channels, messages: [], events: { eligible, enabled: settings.enabled, alive: eligible && settings.enabled,
        deliverToMessengerEvents: settings.deliverToMessengerEvents, eventsChannel: EVENTS_CHANNEL_NAME } },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: { code: 'rodrigo_unavailable' } }, { status: 503 });
  }
}

/** Legacy browser mutations are disabled; Messenger writes only through the v2 action queue. */
export async function POST() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  return NextResponse.json({ error: { code: 'use_v2_action_queue' } }, { status: 410 });
}
