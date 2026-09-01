import { ensureHubUser } from '@/lib/ensure-user';
import {
  getNotificationSnapshot,
  markNotificationsRead,
  setNotificationSettings,
} from '@/lib/notifications';
import type { NotificationCenterSettings } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const snapshot = await getNotificationSnapshot({
    workspaceId: session.workspace.id,
    userId: session.user.id,
  });

  return NextResponse.json(snapshot);
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
