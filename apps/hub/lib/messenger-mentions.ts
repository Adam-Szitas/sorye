import { recordWorkspaceNotification } from '@/lib/notifications';
import {
  memberPersonalPackageIncludes,
  viewerPersonalPackageIncludes,
} from '@/lib/personal-package';
import { getHubSession, getHubSessionForWorkspace, getWorkspaceMembers } from '@/lib/store';
import { getRodrigoResource } from '@/lib/rodrigo/service-client';
import {
  allowMessengerPing,
  mentionSuggestions,
  mentionsFromText,
  pingsToNotify,
  rewriteMentionText,
  type HubSession,
  type MessengerChannel,
  type MessengerMember,
  type MessengerMention,
} from '@sorye/types';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function canSeeChannel(channel: MessengerChannel, userId: string): boolean {
  if (channel.memberIds.length > 0) return channel.memberIds.includes(userId);
  return channel.kind === 'channel';
}

export async function resolveVisibleChannel(
  userId: string,
  channelId: string,
): Promise<{
  channel: MessengerChannel;
  members: MessengerMember[];
  workspaceKind: string;
} | null> {
  if (!ID_RE.test(channelId)) return null;
  const session = await getHubSession(userId);
  if (!session || session.user.id !== userId) return null;

  const workspaceIds = [
    session.workspace.id,
    ...session.workspaces.map((workspace) => workspace.id),
  ];
  const seen = new Set<string>();
  for (const workspaceId of workspaceIds) {
    if (!workspaceId || seen.has(workspaceId)) continue;
    seen.add(workspaceId);
    const scoped = await getHubSessionForWorkspace(userId, workspaceId);
    if (!scoped || scoped.user.id !== userId) continue;
    if (scoped.workspace.id !== workspaceId) continue;
    if (!scoped.workspace.memberIds.includes(userId)) continue;
    if (!scoped.workspace.selectedAppIds.includes('messenger')) continue;
    let snapshot;
    try { snapshot = await getRodrigoResource({ userId, workspaceId }, 'messenger', 'channel', channelId); }
    catch { continue; }
    const raw = snapshot.resource;
    if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.kind !== 'string') continue;
    const kind = raw.kind === 'direct' ? 'dm' : raw.kind === 'public' || raw.kind === 'private' || raw.kind === 'events' ? 'channel' : null;
    if (!kind) continue;
    const memberIds = Array.isArray(raw.memberIds) ? raw.memberIds.filter((id): id is string => typeof id === 'string') : [];
    const channel: MessengerChannel = {
      id: raw.id, workspaceId, kind, name: raw.name, memberIds,
      createdAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
      createdBy: snapshot.createdByUserId ?? '',
    };
    if (channel.kind === 'dm' && !channel.memberIds.includes(userId)) return null;
    if (!canSeeChannel(channel, userId)) return null;
    const members = await getWorkspaceMembers(workspaceId);
    return {
      channel,
      members,
      workspaceKind: scoped.workspace.kind,
    };
  }
  return null;
}

async function personalPingAllowed(
  viewer: HubSession,
  workspaceKind: string,
  userId: string,
): Promise<boolean> {
  if (workspaceKind !== 'personal') return true;
  if (!(await viewerPersonalPackageIncludes(viewer, 'messenger'))) return false;
  if (userId === viewer.user.id) return false;
  const included = await memberPersonalPackageIncludes(userId, 'messenger');
  return allowMessengerPing(workspaceKind, included);
}

export async function suggestMessengerMentions(
  session: HubSession,
  channelId: string,
  query: string,
): Promise<MessengerMember[] | null> {
  const found = await resolveVisibleChannel(session.user.id, channelId);
  if (!found) return null;
  if (
    found.workspaceKind === 'personal' &&
    !(await viewerPersonalPackageIncludes(session, 'messenger'))
  ) {
    return [];
  }
  const allowed = new Map<string, boolean>();
  if (found.workspaceKind === 'personal') {
    await Promise.all(
      found.members.map(async (member) => {
        allowed.set(member.id, await personalPingAllowed(session, found.workspaceKind, member.id));
      }),
    );
  }
  return mentionSuggestions({
    members: found.members,
    channelMemberIds: found.channel.memberIds,
    channelKind: found.channel.kind,
    selfId: session.user.id,
    query: query.slice(0, 80),
    allowed: found.workspaceKind === 'personal' ? (id) => allowed.get(id) === true : undefined,
  }).slice(0, 8);
}

export async function prepareMessengerPings(
  session: HubSession,
  channelId: string,
  text: string,
  requestedIds: readonly string[],
): Promise<{
  text: string;
  notifyIds: string[];
  workspaceId: string;
  channel: MessengerChannel;
} | null> {
  const found = await resolveVisibleChannel(session.user.id, channelId);
  if (!found) return null;
  if (
    found.workspaceKind === 'personal' &&
    !(await viewerPersonalPackageIncludes(session, 'messenger'))
  ) {
    return null;
  }

  const requested = [
    ...mentionsFromText(text).map((mention) => mention.userId),
    ...requestedIds,
  ].slice(0, 20);
  const allowed = new Map<string, boolean>();
  if (found.workspaceKind === 'personal') {
    await Promise.all(
      requested.map(async (id) => {
        if (!ID_RE.test(id)) return;
        allowed.set(id, await personalPingAllowed(session, found.workspaceKind, id));
      }),
    );
  }
  const notifyIds = pingsToNotify({
    requestedIds: requested.filter((id) => ID_RE.test(id)),
    members: found.members,
    channelMemberIds: found.channel.memberIds,
    channelKind: found.channel.kind,
    authorId: session.user.id,
    allowed:
      found.workspaceKind === 'personal' ? (id) => allowed.get(id) === true : undefined,
  });
  const kept: MessengerMention[] = notifyIds.map((userId) => {
    const member = found.members.find((item) => item.id === userId);
    return { userId, name: member?.displayName ?? 'Member' };
  });
  const rewritten = rewriteMentionText(text, kept);
  const stillThere = new Set(mentionsFromText(rewritten).map((mention) => mention.userId));
  return {
    text: rewritten,
    notifyIds: notifyIds.filter((id) => stillThere.has(id)),
    workspaceId: found.channel.workspaceId,
    channel: found.channel,
  };
}

export async function notifyMessengerPings(input: {
  workspaceId: string;
  channel: MessengerChannel;
  authorName: string;
  userIds: readonly string[];
}): Promise<void> {
  const where =
    input.channel.kind === 'dm'
      ? 'In a direct message'
      : `In #${input.channel.name}`;
  await Promise.all(
    input.userIds.map((userId) =>
      recordWorkspaceNotification({
        workspaceId: input.workspaceId,
        userId,
        appId: 'messenger',
        title: `${input.authorName} pinged you`,
        body: where,
        channelId: input.channel.id,
      }),
    ),
  );
}
