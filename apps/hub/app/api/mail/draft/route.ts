import { ensureHubUser } from '@/lib/ensure-user';
import { saveMailDraft } from '@/lib/mail';
import { assertJsonPayloadSize, MAX_MAIL_BYTES } from '@/lib/security-limits';
import type { MailDraftInput } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as MailDraftInput;

  try {
    assertJsonPayloadSize(body, MAX_MAIL_BYTES, 'Mail draft');
    const draft = await saveMailDraft({
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      userId: session.user.id,
      draft: {
        subject: typeof body.subject === 'string' ? body.subject : '',
        body: typeof body.body === 'string' ? body.body : '',
        imageDataUrl:
          typeof body.imageDataUrl === 'string' ? body.imageDataUrl : undefined,
      },
    });
    return NextResponse.json({ draft }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not save draft' },
      { status: 400 },
    );
  }
}
