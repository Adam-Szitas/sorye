import { ensureHubUser } from '@/lib/ensure-user';
import {
  getExternalMessage,
  getMailAccountSecret,
  setExternalMessageBody,
} from '@/lib/mail';
import { fetchMailBody, publicMailError } from '@/lib/mail-imap';
import { assertMailRateLimit, mailRateKey } from '@/lib/mail-rate-limit';
import { NextResponse } from 'next/server';

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string; messageId: string }> },
) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, messageId } = await context.params;
  const accountId = id?.trim() ?? '';
  const mid = messageId?.trim() ?? '';
  if (!accountId || accountId.length > 64 || !mid || mid.length > 120) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  const scope = {
    workspaceId: session.workspace.id,
    workspaceName: session.workspace.name,
    userId: session.user.id,
  };

  try {
    const existing = await getExternalMessage({
      ...scope,
      accountId,
      messageId: mid,
    });
    if (existing.body) {
      return NextResponse.json({ message: existing });
    }

    assertMailRateLimit(
      mailRateKey(session.workspace.id, session.user.id, 'read'),
      60,
      5 * 60_000,
    );
    const secret = await getMailAccountSecret({ ...scope, accountId });
    const body = await fetchMailBody({
      account: secret.account,
      password: secret.password,
      folder: existing.folder,
      uid: existing.uid,
    });
    const message = await setExternalMessageBody({
      ...scope,
      accountId,
      messageId: mid,
      body,
    });
    return NextResponse.json({ message });
  } catch (err) {
    const message = publicMailError(err, 'Could not load message');
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
