import { ensureHubUser } from '@/lib/ensure-user';
import { publishWorkspaceEvent } from '@/lib/events';
import { getMailAccountSecret } from '@/lib/mail';
import { parseExternalSend } from '@/lib/mail-accounts';
import { publicMailError, sendSmtpMail } from '@/lib/mail-imap';
import { assertMailRateLimit, mailRateKey } from '@/lib/mail-rate-limit';
import {
  assertJsonPayloadSize,
  MAX_MAIL_BYTES,
  MAX_MESSAGE_TEXT_LENGTH,
  validateImageDataUrl,
} from '@/lib/security-limits';
import { NextResponse } from 'next/server';

export async function POST(
  req: Request,
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

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  try {
    assertJsonPayloadSize(body, MAX_MAIL_BYTES, 'Mail');
    if (typeof body.body === 'string' && body.body.length > MAX_MESSAGE_TEXT_LENGTH) {
      return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
    }
    assertMailRateLimit(
      mailRateKey(session.workspace.id, session.user.id, 'send'),
      20,
      10 * 60_000,
    );
    const parsed = parseExternalSend(body);
    let imageDataUrl: string | undefined;
    if (parsed.imageDataUrl) {
      const image = validateImageDataUrl(parsed.imageDataUrl);
      if (!image.ok) throw new Error(image.error);
      imageDataUrl = image.dataUrl;
    }
    const secret = await getMailAccountSecret({
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      userId: session.user.id,
      accountId,
    });
    await sendSmtpMail({
      account: secret.account,
      password: secret.password,
      toAddress: parsed.toAddress,
      subject: parsed.subject,
      body: parsed.body,
      imageDataUrl,
    });

    await publishWorkspaceEvent({
      userId: session.user.id,
      workspaceId: session.workspace.id,
      name: 'sorye.mail.sent',
      payload: {
        title: 'Mail sent',
        summary: `${session.user.displayName} → ${parsed.toAddress}: ${parsed.subject}`,
        appId: 'mail',
        entityId: accountId,
        meta: {
          accountId,
          fromAddress: secret.account.email,
          toAddress: parsed.toAddress,
        },
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: publicMailError(err, 'Could not send mail'),
      },
      { status: 400 },
    );
  }
}
