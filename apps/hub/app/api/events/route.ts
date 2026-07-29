import { ensureHubUser } from '@/lib/ensure-user';
import {
  getEventsStatus,
  publishWorkspaceEvent,
  setEventSettings,
  setEventsFeatureEnabled,
} from '@/lib/events';
import type { WorkspaceEventName, WorkspaceEventPayload } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = await getEventsStatus(
    session.user.id,
    session.workspace.id,
  );
  if (!status) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(status);
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: WorkspaceEventName;
    payload?: WorkspaceEventPayload;
  };

  if (!body.name || !body.payload?.title) {
    return NextResponse.json(
      { error: 'name and payload.title are required' },
      { status: 400 },
    );
  }

  const result = await publishWorkspaceEvent({
    userId: session.user.id,
    workspaceId: session.workspace.id,
    name: body.name,
    payload: body.payload,
  });

  if (!result) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(result, {
    status: result.delivered ? 201 : 200,
  });
}

export async function PATCH(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    deliverToMessengerEvents?: boolean;
  };

  if (
    typeof body.enabled !== 'boolean' &&
    typeof body.deliverToMessengerEvents !== 'boolean'
  ) {
    return NextResponse.json(
      {
        error:
          'Provide enabled (feature flag) and/or deliverToMessengerEvents',
      },
      { status: 400 },
    );
  }

  if (typeof body.enabled === 'boolean') {
    const result = await setEventsFeatureEnabled({
      userId: session.user.id,
      workspaceId: session.workspace.id,
      enabled: body.enabled,
    });
    if (!result) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (typeof body.deliverToMessengerEvents === 'boolean') {
      const settings = await setEventSettings(session.workspace.id, {
        deliverToMessengerEvents: body.deliverToMessengerEvents,
      });
      return NextResponse.json({
        settings,
        eligible: result.eligible,
        alive: result.eligible && settings.enabled,
      });
    }

    return NextResponse.json(result);
  }

  const settings = await setEventSettings(session.workspace.id, {
    deliverToMessengerEvents: body.deliverToMessengerEvents!,
  });
  const status = await getEventsStatus(
    session.user.id,
    session.workspace.id,
  );

  return NextResponse.json({
    settings,
    eligible: status?.eligible ?? false,
    alive: status?.alive ?? false,
  });
}
