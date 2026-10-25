import { ensureHubUser } from '@/lib/ensure-user';
import { listExternalMessages } from '@/lib/mail';
import type { MailFolderId } from '@sorye/types';
import { NextResponse } from 'next/server';

const FOLDERS = new Set<MailFolderId>(['inbox', 'sent', 'drafts']);

export async function GET(
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

  const folderRaw = new URL(req.url).searchParams.get('folder') ?? 'inbox';
  if (!FOLDERS.has(folderRaw as MailFolderId)) {
    return NextResponse.json({ error: 'Unknown folder' }, { status: 400 });
  }

  try {
    const messages = await listExternalMessages({
      workspaceId: session.workspace.id,
      workspaceName: session.workspace.name,
      userId: session.user.id,
      accountId,
      folder: folderRaw as MailFolderId,
    });
    return NextResponse.json({ messages });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not load messages';
    return NextResponse.json(
      { error: message },
      { status: message === 'Mail account not found' ? 404 : 400 },
    );
  }
}
