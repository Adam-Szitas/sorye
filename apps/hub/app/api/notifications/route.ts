import { ensureHubUser } from '@/lib/ensure-user';
import {
  getNotificationSnapshot,
  markNotificationsRead,
  setNotificationSettings,
} from '@/lib/notifications';
import { NOTIFIABLE_APP_IDS, type NotificationCenterSettings } from '@sorye/types';
import { viewerPersonalPackageAppIds } from '@/lib/personal-package';
import { readPartitionedLoad } from '@/lib/user-load-read';
import { NextResponse } from 'next/server';
import { ServerTimings } from '@/lib/server-timing';

export async function GET() {
  const timings = new ServerTimings();
  const session = await timings.measure('session', () => ensureHubUser(timings));
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: timings.headers() });
  }

  const snapshot = await timings.measure('notifications', () => getNotificationSnapshot({
    workspaceId: session.workspace.id,
    userId: session.user.id,
  }));
  const packageIds = new Set(await viewerPersonalPackageAppIds(session));
  const notifications = session.workspace.kind === 'personal'
    ? snapshot.notifications.filter((notice) => packageIds.has(notice.appId))
    : snapshot.notifications;
  const load = await timings.measure('notification_load', () => readPartitionedLoad(session, async (scope) => {
    const side = await getNotificationSnapshot({
      workspaceId: scope.id,
      userId: session.user.id,
    });
    return side.notifications.map((notice) => ({ workspaceId: scope.id, value: notice }));
  }, {
    itemAppId: (notice) => notice.appId,
    personalApps: NOTIFIABLE_APP_IDS,
  }));
  const otherUnread = [...load.personal, ...load.work]
    .filter((group) => group.workspace.id !== session.workspace.id)
    .reduce((sum, group) => sum + group.items.filter((item) => !item.value.read).length, 0);

  return NextResponse.json(
    { ...snapshot, notifications, load, unreadTotal: snapshot.unreadTotal + otherUnread },
    { headers: { ...timings.headers(), 'Cache-Control': 'private, no-store' } },
  );
}

export async function PATCH(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<
    Pick<NotificationCenterSettings, 'toastsEnabled' | 'toastApps'>
  >;

  const settings = await setNotificationSettings(
    session.workspace.id,
    session.user.id,
    body,
  );

  const snapshot = await getNotificationSnapshot({
    workspaceId: session.workspace.id,
    userId: session.user.id,
  });

  return NextResponse.json({ ...snapshot, settings });
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'mark-read';
    notificationIds?: string[];
    appId?: string;
    all?: boolean;
  };

  if (body.action !== 'mark-read') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  }

  const snapshot = await markNotificationsRead({
    workspaceId: session.workspace.id,
    userId: session.user.id,
    notificationIds: body.notificationIds,
    appId: body.appId,
    all: body.all,
  });

  return NextResponse.json(snapshot);
}

