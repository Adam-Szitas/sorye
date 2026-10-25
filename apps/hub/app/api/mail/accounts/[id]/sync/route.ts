import { ensureHubUser } from '@/lib/ensure-user';
import {
  getMailAccountSecret,
  putExternalMessages,
  updateMailAccountStatus,
} from '@/lib/mail';
import { publicMailError, syncMailAccount } from '@/lib/mail-imap';
import { assertMailRateLimit, mailRateKey } from '@/lib/mail-rate-limit';
import { NextResponse } from 'next/server';

export async function POST(
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

  const scope = {
    workspaceId: session.workspace.id,
    workspaceName: session.workspace.name,
    userId: session.user.id,
  };

  try {
    assertMailRateLimit(
      mailRateKey(session.workspace.id, session.user.id, 'sync'),
      12,
      5 * 60_000,
    );
    const secret = await getMailAccountSecret({ ...scope, accountId });
    const folders = await syncMailAccount({
      account: secret.account,
      password: secret.password,
    });
    const cached = await putExternalMessages({
      ...scope,
      accountId,
      folders,
    });
    return NextResponse.json({
      account: {
        ...secret.account,
        lastSync: new Date().toISOString(),
        status: 'ok' as const,
        statusMessage: undefined,
      },
      folders: cached,
    });
  } catch (err) {
    const message = publicMailError(err, 'Could not sync mail');
    try {
      await updateMailAccountStatus({
        ...scope,
        accountId,
        status: 'error',
        statusMessage: message,
      });
    } catch {
      // Status update is best-effort after a failed sync.
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
