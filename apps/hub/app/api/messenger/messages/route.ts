import { ensureHubUser } from '@/lib/ensure-user';
import { listMessages } from '@/lib/store/messenger';
import {
  MESSENGER_PAGE_SIZE,
  MESSENGER_PAGE_SIZE_MAX,
} from '@sorye/types';
import { NextResponse } from 'next/server';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function parseId(raw: string | null, label: string): string | null {
  if (raw == null || raw === '') return null;
  if (!ID_RE.test(raw)) {
    throw new Error(`Invalid ${label}`);
  }
  return raw;
}

function parseLimit(raw: string | null): number {
  if (raw == null || raw === '') return MESSENGER_PAGE_SIZE;
  if (!/^\d{1,2}$/.test(raw)) {
    throw new Error('Invalid limit');
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MESSENGER_PAGE_SIZE_MAX) {
    throw new Error('Invalid limit');
  }
  return n;
}

function parseAfter(raw: string | null): string | undefined {
  if (raw == null || raw === '') return undefined;
  if (!ISO_RE.test(raw)) {
    throw new Error('Invalid after');
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new Error('Invalid after');
  }
  return raw;
}

export async function GET(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  let channelId: string;
  let limit: number;
  let after: string | undefined;
  let afterId: string | undefined;
  let before: string | undefined;
  try {
    const parsedChannel = parseId(searchParams.get('channelId'), 'channelId');
    if (!parsedChannel) {
      return NextResponse.json(
        { error: 'channelId is required' },
        { status: 400 },
      );
    }
    channelId = parsedChannel;
    limit = parseLimit(searchParams.get('limit'));
    after = parseAfter(searchParams.get('after'));
    afterId = parseId(searchParams.get('afterId'), 'afterId') ?? undefined;
    const beforeRaw = searchParams.get('before') ?? searchParams.get('cursor');
    before = parseId(beforeRaw, 'before') ?? undefined;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid query' },
      { status: 400 },
    );
  }

  if ((afterId && !after) || (after && before)) {
    return NextResponse.json(
      { error: afterId && !after ? 'afterId requires after' : 'Use after or before, not both' },
      { status: 400 },
    );
  }

  const result = await listMessages(
    session.user.id,
    session.workspace.id,
    channelId,
    { after, afterId, before, limit },
  );

  if (result.status === 'forbidden') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (result.status === 'cursor') {
    return NextResponse.json(
      { error: 'Unknown before cursor' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    messages: result.messages,
    hasMore: result.hasMore,
  });
}
