import { ensureHubUser } from '@/lib/ensure-user';
import { getEventSettings } from '@/lib/events';
import {
  getRelayConfig,
  ingestRelayTestMessage,
  setRelayConfig,
} from '@/lib/relay';
import type { RelayConfig } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getRelayConfig(session.workspace.id);
  const settings = await getEventSettings(session.workspace.id);

  return NextResponse.json({
    config,
    eventsEnabled: settings.enabled,
    deliverToMessengerEvents: settings.deliverToMessengerEvents,
  });
}

export async function PATCH(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<
    Pick<
      RelayConfig,
      | 'sources'
      | 'channels'
      | 'routes'
      | 'quietHoursEnabled'
      | 'quietHoursStart'
      | 'quietHoursEnd'
    >
  >;

  try {
    const config = await setRelayConfig(session.workspace.id, body);
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : 'Invalid relay configuration',
      },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    sourceAppId?: string;
    title?: string;
    body?: string;
  };

  if (body.action !== 'test') {
    return NextResponse.json(
      { error: 'Unsupported action. Use action: "test".' },
      { status: 400 },
    );
  }

  if (!body.sourceAppId) {
    return NextResponse.json(
      { error: 'sourceAppId is required' },
      { status: 400 },
    );
  }

  const settings = await getEventSettings(session.workspace.id);
  const result = await ingestRelayTestMessage({
    workspaceId: session.workspace.id,
    userId: session.user.id,
    sourceAppId: body.sourceAppId,
    title: body.title?.trim() || 'Relay test notification',
    body:
      body.body?.trim() ||
      'Test message from Relay — check Messenger #events if that route is on.',
    allowMessenger: settings.enabled && settings.deliverToMessengerEvents,
  });

  const config = await getRelayConfig(session.workspace.id);
  return NextResponse.json(
    {
      config,
      deliveredMessenger: result.deliveredMessenger,
      message: result.message,
      reason: result.reason,
      eventsEnabled: settings.enabled,
    },
    { status: result.message ? 201 : 200 },
  );
}
