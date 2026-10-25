import { ensureHubUser } from '@/lib/ensure-user';
import { removeMailAccount } from '@/lib/mail';
import { assertMailRateLimit, mailRateKey } from '@/lib/mail-rate-limit';
import { NextResponse } from 'next/server';

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const accountId = id?.trim() ?? '';
  if (!accountId || accountId.length > 64) {
    return NextResponse.json({ error: 'Mail account not found' }, { status: 404 });
  }

  try {
    assertMailRateLimit(
      mailRateKey(session.workspace.id, session.user.id, 'remove'),
      20,
      10 * 60_000,
    );
    await removeMailAccount({
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      userId: session.user.id,
      accountId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not remove account';
    return NextResponse.json(
      { error: message },
      { status: message === 'Mail account not found' ? 404 : 400 },
    );
  }
}
