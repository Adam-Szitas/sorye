import { ensureHubUser } from '@/lib/ensure-user';
import { publishWorkspaceEvent } from '@/lib/events';
import {
  createWorkspaceFile,
  FileAccessError,
  listWorkspaceFiles,
} from '@/lib/files';
import { FILE_MAX_BYTES, FILE_MAX_PER_WORKSPACE } from '@sorye/types';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function errorResponse(err: unknown) {
  if (err instanceof FileAccessError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'Could not process files' },
    { status: 400 },
  );
}

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const files = await listWorkspaceFiles(session.workspace.id);
    return NextResponse.json({
      files,
      maxBytes: FILE_MAX_BYTES,
      maxFiles: FILE_MAX_PER_WORKSPACE,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
  }

  const upload = form.get('file');
  if (!(upload instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  if (upload.size > FILE_MAX_BYTES) {
    return NextResponse.json(
      {
        error: `File is too large (max ${Math.floor(FILE_MAX_BYTES / (1024 * 1024))} MB)`,
      },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await upload.arrayBuffer());
  if (bytes.length > FILE_MAX_BYTES) {
    return NextResponse.json(
      {
        error: `File is too large (max ${Math.floor(FILE_MAX_BYTES / (1024 * 1024))} MB)`,
      },
      { status: 400 },
    );
  }

  let file;
  try {
    file = await createWorkspaceFile({
      workspaceId: session.workspace.id,
      displayName: upload.name,
      bytes,
    });
  } catch (err) {
    return errorResponse(err);
  }

  await publishWorkspaceEvent({
    userId: session.user.id,
    workspaceId: session.workspace.id,
    name: 'sorye.files.uploaded',
    payload: {
      title: 'File uploaded',
      summary: `${session.user.displayName} uploaded ${file.displayName}`,
      appId: 'files',
      entityId: file.id,
      meta: {
        mime: file.mime,
        size: file.size,
      },
    },
  });

  return NextResponse.json({ file }, { status: 201 });
}
