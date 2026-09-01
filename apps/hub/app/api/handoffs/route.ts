import { ensureHubUser } from '@/lib/ensure-user';
import {
  consumeHandoff,
  createHandoff,
  getHandoff,
  listHandoffs,
} from '@/lib/handoffs';
import { assertJsonPayloadSize, MAX_HANDOFF_PAYLOAD_BYTES } from '@/lib/security';
import type { CreateHandoffInput, HandoffKind } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (id) {
    const handoff = await getHandoff(session.workspace.id, id);
    if (!handoff) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ handoff });
  }

  const targetAppId = url.searchParams.get('targetAppId') ?? undefined;
  const unconsumedOnly = url.searchParams.get('unconsumed') === '1';
  const handoffs = await listHandoffs(session.workspace.id, {
    targetAppId,
    unconsumedOnly,
  });
  return NextResponse.json({ handoffs });
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<CreateHandoffInput>;
  if (
    !body.sourceAppId ||
    !body.targetAppId ||
    !body.kind ||
    !body.title ||
    body.payload == null
  ) {
    return NextResponse.json(
      {
        error:
          'sourceAppId, targetAppId, kind, title, and payload are required',
      },
      { status: 400 },
    );
  }

  const kind = body.kind as HandoffKind;
  if (kind !== 'pdf-template') {
    return NextResponse.json({ error: 'Unsupported kind' }, { status: 400 });
  }

  try {
    assertJsonPayloadSize(body.payload, MAX_HANDOFF_PAYLOAD_BYTES, 'Handoff payload');
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Payload too large' },
      { status: 400 },
    );
  }

  const handoff = await createHandoff(session.workspace.id, {
    sourceAppId: body.sourceAppId,
    targetAppId: body.targetAppId,
    kind,
    title: body.title,
    summary: body.summary,
    payload: body.payload,
  });

  return NextResponse.json({ handoff }, { status: 201 });
}

export async function PATCH(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    consume?: boolean;
  };

  if (!body.id || body.consume !== true) {
    return NextResponse.json(
      { error: 'id and consume:true are required' },
      { status: 400 },
    );
  }

  const handoff = await consumeHandoff(session.workspace.id, body.id);
  if (!handoff) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ handoff });
}
