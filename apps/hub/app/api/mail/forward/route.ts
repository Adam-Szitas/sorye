import { ensureHubUser } from '@/lib/ensure-user';
import { saveMailDraft } from '@/lib/mail';
import { assertJsonPayloadSize, MAX_MAIL_BYTES } from '@/lib/security-limits';
import { NextResponse } from 'next/server';

/** Messenger → Mail: store a compose draft. Does not send internet email. */
export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    subject?: string;
    body?: string;
    imageDataUrl?: string;
    authorName?: string;
  };

  try {
    assertJsonPayloadSize(body, MAX_MAIL_BYTES, 'Mail forward');
    const author =
      typeof body.authorName === 'string' && body.authorName.trim()
        ? body.authorName.trim().slice(0, 80)
        : 'Messenger';
    const subject =
      typeof body.subject === 'string' && body.subject.trim()
        ? body.subject.trim()
        : `Forwarded from ${author}`;
    const draft = await saveMailDraft({
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      userId: session.user.id,
      draft: {
        subject,
        body: typeof body.body === 'string' ? body.body : '',
        imageDataUrl:
          typeof body.imageDataUrl === 'string' ? body.imageDataUrl : undefined,
      },
    });
    return NextResponse.json({ draft }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not forward to Mail' },
      { status: 400 },
    );
  }
}
