import { ensureHubUser } from '@/lib/ensure-user';
import { publishWorkspaceEvent } from '@/lib/events';
import { bootstrapMail, sendMail, updateMailSettings } from '@/lib/mail';
import {
  assertJsonPayloadSize,
  MAX_MAIL_BYTES,
  MAX_MESSAGE_TEXT_LENGTH,
} from '@/lib/security-limits';
import { ensureEventsChannel, postSystemMessage } from '@/lib/store/messenger';
import type { MailSettingsInput, SendMailInput } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const mailbox = await bootstrapMail({
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      userId: session.user.id,
    });
    return NextResponse.json(mailbox);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not load Mail' },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<SendMailInput>;

  try {
    assertJsonPayloadSize(body, MAX_MAIL_BYTES, 'Mail');
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Payload too large' },
      { status: 400 },
    );
  }

  if (typeof body.body === 'string' && body.body.length > MAX_MESSAGE_TEXT_LENGTH) {
    return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
  }

  let sent;
  try {
    sent = await sendMail({
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      userId: session.user.id,
      displayName: session.user.displayName,
      body: {
        toUserId: typeof body.toUserId === 'string' ? body.toUserId : undefined,
        toAddress: typeof body.toAddress === 'string' ? body.toAddress : undefined,
        subject: typeof body.subject === 'string' ? body.subject : '',
        body: typeof body.body === 'string' ? body.body : '',
        imageDataUrl:
          typeof body.imageDataUrl === 'string' ? body.imageDataUrl : undefined,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not send mail' },
      { status: 400 },
    );
  }

  await publishWorkspaceEvent({
    userId: session.user.id,
    workspaceId: session.workspace.id,
    name: 'sorye.mail.sent',
    payload: {
      title: 'Mail sent',
      summary: `${session.user.displayName} → ${sent.message.toName}: ${sent.message.subject}`,
      appId: 'mail',
      entityId: sent.message.id,
      meta: {
        toUserId: sent.message.toUserId,
        fromAddress: sent.message.fromAddress,
      },
    },
  });

  if (sent.notifyMessenger) {
    try {
      const channel = await ensureEventsChannel(
        session.workspace.id,
        session.user.id,
      );
      await postSystemMessage(
        session.workspace.id,
        channel.id,
        `**Mail**\n${session.user.displayName} sent “${sent.message.subject}” to ${sent.message.toName}\n\`sorye.mail.sent\``,
        { id: 'sorye-mail', name: 'Sorye Mail' },
      );
    } catch {
      // Messenger notify is best-effort — the in-app message already saved.
    }
  }

  return NextResponse.json({ message: sent.message }, { status: 201 });
}

export async function PATCH(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as MailSettingsInput & {
    workspaceId?: unknown;
  };
  if (body.workspaceId != null) {
    return NextResponse.json(
      { error: 'workspaceId cannot be set by the client' },
      { status: 400 },
    );
  }

  try {
    assertJsonPayloadSize(body, 4_000, 'Mail settings');
    const profile = await updateMailSettings({
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      userId: session.user.id,
      displayName: session.user.displayName,
      patch: {
        personalEmail:
          typeof body.personalEmail === 'string' ? body.personalEmail : undefined,
        notifyMessenger:
          typeof body.notifyMessenger === 'boolean'
            ? body.notifyMessenger
            : undefined,
      },
    });
    return NextResponse.json({ profile });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not save settings' },
      { status: 400 },
    );
  }
}
