import { ensureHubUser } from '@/lib/ensure-user';
import {
  bootstrapMessenger,
  createPublicChannel,
  openDirectMessage,
  postMessage,
} from '@/lib/store/messenger';
import { getEventSettings } from '@/lib/events';
import {
  EVENTS_CHANNEL_NAME,
  isMessengerEventsEligible,
  type MessengerMessageKind,
} from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = await bootstrapMessenger(
    session.user.id,
    session.workspace.id,
  );
  if (!data) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const settings = await getEventSettings(session.workspace.id);
  const eligible = isMessengerEventsEligible(session.workspace.selectedAppIds);

  return NextResponse.json({
    ...data,
    events: {
      eligible,
      enabled: settings.enabled,
      alive: eligible && settings.enabled,
      deliverToMessengerEvents: settings.deliverToMessengerEvents,
      eventsChannel: EVENTS_CHANNEL_NAME,
    },
  });
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'dm' | 'channel' | 'message';
    peerUserId?: string;
    name?: string;
    channelId?: string;
    kind?: MessengerMessageKind;
    text?: string;
    imageDataUrl?: string;
    imageBytes?: number;
    imageWidth?: number;
    imageHeight?: number;
  };

  const workspaceId = session.workspace.id;
  const userId = session.user.id;

  if (body.action === 'dm') {
    if (!body.peerUserId) {
      return NextResponse.json(
        { error: 'peerUserId is required' },
        { status: 400 },
      );
    }
    const channel = await openDirectMessage(
      userId,
      workspaceId,
      body.peerUserId,
    );
    if (!channel) {
      return NextResponse.json(
        { error: 'Could not open DM (peer must be a workspace member)' },
        { status: 400 },
      );
    }
    return NextResponse.json({ channel }, { status: 201 });
  }

  if (body.action === 'channel') {
    const channel = await createPublicChannel(
      userId,
      workspaceId,
      body.name ?? '',
    );
    if (!channel) {
      return NextResponse.json(
        { error: 'Could not create channel' },
        { status: 400 },
      );
    }
    return NextResponse.json({ channel }, { status: 201 });
  }

  if (body.action === 'message') {
    if (!body.channelId || !body.kind) {
      return NextResponse.json(
        { error: 'channelId and kind are required' },
        { status: 400 },
      );
    }
    const message = await postMessage(userId, workspaceId, {
      channelId: body.channelId,
      kind: body.kind,
      text: body.text,
      imageDataUrl: body.imageDataUrl,
      imageBytes: body.imageBytes,
      imageWidth: body.imageWidth,
      imageHeight: body.imageHeight,
    });
    if (!message) {
      return NextResponse.json(
        { error: 'Could not post message' },
        { status: 400 },
      );
    }
    return NextResponse.json({ message }, { status: 201 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
