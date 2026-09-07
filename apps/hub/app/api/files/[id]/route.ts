import { ensureHubUser } from '@/lib/ensure-user';
import { isInlinePreviewMime } from '@/lib/file-preview';
import {
  contentDisposition,
  deleteWorkspaceFile,
  FileAccessError,
  readWorkspaceFileBytes,
  renameWorkspaceFile,
} from '@/lib/files';
import { FILE_DISPLAY_NAME_MAX } from '@sorye/types';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

function errorResponse(err: unknown) {
  if (err instanceof FileAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'Could not process file' },
    { status: 400 },
  );
}

export async function GET(req: Request, { params }: Params) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const wantInline = new URL(req.url).searchParams.get('inline') === '1';
  try {
    const { file, bytes } = await readWorkspaceFileBytes(
      session.workspace.id,
      id,
    );
    const inline = wantInline && isInlinePreviewMime(file.mime);
    const body = new Uint8Array(bytes);
    return new NextResponse(body, {
      headers: {
        'Content-Type': file.mime,
        'Content-Disposition': contentDisposition(
          file.displayName,
          inline ? 'inline' : 'attachment',
        ),
        'Content-Length': String(bytes.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { displayName?: unknown };
  if (typeof body.displayName !== 'string') {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
  }
  if (body.displayName.trim().length > FILE_DISPLAY_NAME_MAX) {
    return NextResponse.json({ error: 'Name is too long' }, { status: 400 });
  }

  try {
    const file = await renameWorkspaceFile(
      session.workspace.id,
      id,
      body.displayName,
    );
    return NextResponse.json({ file });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  try {
    await deleteWorkspaceFile(session.workspace.id, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
