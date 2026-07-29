import { ensureHubUser } from '@/lib/ensure-user';
import { listMessages } from '@/lib/store/messenger';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const channelId = searchParams.get('channelId');
  const after = searchParams.get('after') ?? undefined;

  if (!channelId) {
    return NextResponse.json(
      { error: 'channelId is required' },
      { status: 400 },
    );
  }

  const messages = await listMessages(
    session.user.id,
    session.workspace.id,
    channelId,
    after,
  );

  if (!messages) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ messages });
}
