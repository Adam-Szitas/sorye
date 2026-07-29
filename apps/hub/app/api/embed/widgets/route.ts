import { ensureHubUser } from '@/lib/ensure-user';
import {
  createEmbedWidget,
  listEmbedWidgets,
  revokeEmbedWidget,
  updateEmbedWidget,
} from '@/lib/store/embed';
import { APP_CATALOG, normalizeOrigin } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const widgets = await listEmbedWidgets(session.workspace.id);
  return NextResponse.json({ widgets });
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as {
    name?: string;
    allowedOrigins?: string[];
    enabledAppIds?: string[];
  };

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const origins = (body.allowedOrigins ?? [])
    .map((o) => normalizeOrigin(o))
    .filter((o): o is string => Boolean(o));

  if (origins.length === 0) {
    return NextResponse.json(
      { error: 'At least one allowed origin is required (e.g. https://myapp.com)' },
      { status: 400 },
    );
  }

  const requested = body.enabledAppIds?.length
    ? body.enabledAppIds
    : session.workspace.selectedAppIds;

  const catalogIds = new Set(APP_CATALOG.map((a) => a.id));
  const enabledAppIds = requested.filter(
    (id) =>
      catalogIds.has(id) && session.workspace.selectedAppIds.includes(id),
  );

  if (enabledAppIds.length === 0) {
    return NextResponse.json(
      {
        error:
          'Select at least one enabled hub app. Enable apps in the App Library first.',
      },
      { status: 400 },
    );
  }

  const widget = await createEmbedWidget({
    workspaceId: session.workspace.id,
    createdBy: session.user.id,
    name,
    allowedOrigins: origins,
    enabledAppIds,
  });

  return NextResponse.json({ widget }, { status: 201 });
}

export async function PATCH(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as {
    id?: string;
    name?: string;
    allowedOrigins?: string[];
    enabledAppIds?: string[];
  };

  if (!body.id) {
    return NextResponse.json({ error: 'Widget id required' }, { status: 400 });
  }

  const patch: {
    name?: string;
    allowedOrigins?: string[];
    enabledAppIds?: string[];
  } = {};

  if (body.name !== undefined) patch.name = body.name;
  if (body.allowedOrigins !== undefined) patch.allowedOrigins = body.allowedOrigins;
  if (body.enabledAppIds !== undefined) {
    patch.enabledAppIds = body.enabledAppIds.filter((id) =>
      session.workspace.selectedAppIds.includes(id),
    );
  }

  const widget = await updateEmbedWidget(
    session.workspace.id,
    body.id,
    patch,
  );

  if (!widget) {
    return NextResponse.json({ error: 'Widget not found' }, { status: 404 });
  }

  return NextResponse.json({ widget });
}

export async function DELETE(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Widget id required' }, { status: 400 });
  }

  const ok = await revokeEmbedWidget(session.workspace.id, id);
  if (!ok) {
    return NextResponse.json({ error: 'Widget not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
