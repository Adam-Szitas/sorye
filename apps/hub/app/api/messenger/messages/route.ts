import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { getWorkspaceMembers } from '@/lib/store';
import { viewerPersonalPackageIncludes } from '@/lib/personal-package';
import { getRodrigoResource, listRodrigoMessengerMessages } from '@/lib/rodrigo/service-client';
import { MESSENGER_PAGE_SIZE, MESSENGER_PAGE_SIZE_MAX, withMessengerMentions, type MessengerMessage } from '@sorye/types';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export async function GET(req: Request) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('messenger')) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  if (session.workspace.kind === 'personal' && !(await viewerPersonalPackageIncludes(session, 'messenger'))) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  const channelId = params.get('channelId') ?? '';
  const limitRaw = params.get('limit');
  const limit = limitRaw ? Number(limitRaw) : MESSENGER_PAGE_SIZE;
  const before = params.get('before') ?? params.get('cursor');
  const after = params.get('after');
  const afterId = params.get('afterId');
  if (!ID_RE.test(channelId) || !Number.isInteger(limit) || limit < 1 || limit > MESSENGER_PAGE_SIZE_MAX
    || (before && after) || (afterId && !after) || (after && (!ISO_RE.test(after) || Number.isNaN(Date.parse(after))))
    || (before && !ID_RE.test(before)) || (after && (!afterId || !ID_RE.test(afterId)))) {
    return NextResponse.json({ error: { code: 'invalid_query' } }, { status: 400 });
  }

  try {
    const context = { userId: session.user.id, workspaceId: session.workspace.id };
    const channel = await getRodrigoResource(context, 'messenger', 'channel', channelId);
    const rawChannel = channel.resource;
    if (!rawChannel || !Array.isArray(rawChannel.memberIds)) return NextResponse.json({ error: { code: 'channel_forbidden' } }, { status: 403 });
    const memberIds = rawChannel.memberIds.filter((id): id is string => typeof id === 'string');
    const kind = rawChannel.kind;
    if ((kind === 'direct' || kind === 'private') && !memberIds.includes(session.user.id)) {
      return NextResponse.json({ error: { code: 'channel_forbidden' } }, { status: 403 });
    }
    if (!['public', 'events', 'direct', 'private'].includes(String(kind))) return NextResponse.json({ error: { code: 'channel_forbidden' } }, { status: 403 });
    let direction: 'older' | 'newer' = 'older';
    let cursor = 'latest';
    if (before) {
      const snapshot = await getRodrigoResource(context, 'messenger', 'message', before);
      const payload = snapshot.resource;
      if (!payload || payload.channelId !== channelId || typeof payload.createdAt !== 'string' || !ISO_RE.test(payload.createdAt)) {
        return NextResponse.json({ error: { code: 'invalid_cursor' } }, { status: 400 });
      }
      cursor = `${payload.createdAt}|${before}`;
    } else if (after) {
      direction = 'newer';
      cursor = `${after}|${afterId}`;
    }
    const page = await listRodrigoMessengerMessages(context, channelId, { direction, limit, cursor });
    const members = await getWorkspaceMembers(session.workspace.id);
    const profiles = new Map(members.map((member) => [member.id, member]));
    const messages: MessengerMessage[] = page.messages.flatMap((item) => {
      const payload = item.resource;
      if (typeof payload.channelId !== 'string' || payload.channelId !== channelId || typeof payload.body !== 'string' || typeof payload.createdAt !== 'string') return [];
      const authorId = item.createdByUserId ?? '';
      const member = profiles.get(authorId);
      return [withMessengerMentions({ id: item.resourceId, channelId, workspaceId: session.workspace.id, kind: 'text' as const,
        text: payload.body, author: { id: authorId, name: member?.displayName ?? 'Member', ...(member?.image ? { image: member.image } : {}) }, createdAt: payload.createdAt })];
    });
    return NextResponse.json({ messages, hasMore: page.hasMore }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: { code: 'rodrigo_unavailable' } }, { status: 503 });
  }
}
