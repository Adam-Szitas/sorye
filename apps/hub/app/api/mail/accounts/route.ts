import { ensureHubUser } from '@/lib/ensure-user';
import { addMailAccount, listMailAccounts } from '@/lib/mail';
import { parseAddMailAccount } from '@/lib/mail-accounts';
import { publicMailError, testMailConnection } from '@/lib/mail-imap';
import { assertMailRateLimit, mailRateKey } from '@/lib/mail-rate-limit';
import { assertJsonPayloadSize, MAX_MAIL_ACCOUNT_BYTES } from '@/lib/security-limits';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const accounts = await listMailAccounts({
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      userId: session.user.id,
    });
    return NextResponse.json({ accounts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not load accounts' },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    assertJsonPayloadSize(body, MAX_MAIL_ACCOUNT_BYTES, 'Mail account');
    assertMailRateLimit(
      mailRateKey(session.workspace.id, session.user.id, 'add'),
      8,
      10 * 60_000,
    );
    const parsed = await parseAddMailAccount(body);
    await testMailConnection({
      imap: parsed.imap,
      smtp: parsed.smtp,
      username: parsed.username,
      password: parsed.password,
    });
    const account = await addMailAccount({
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      userId: session.user.id,
      record: {
        label: parsed.label,
        email: parsed.email,
        provider: parsed.provider,
        imap: parsed.imap,
        smtp: parsed.smtp,
        username: parsed.username,
        password: parsed.password,
        lastSync: null,
        status: 'ok',
      },
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: publicMailError(err, 'Could not add account') },
      { status: 400 },
    );
  }
}
