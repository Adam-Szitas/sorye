import { ensureHubUser } from '@/lib/ensure-user';
import { createDriveFolder, listDriveFolders } from '@/lib/rodrigo/drive-client';
import { NextResponse } from 'next/server';
import { createCloudStorageFolder } from '@/lib/cloud-storage';
import { boundedBodyStream } from '@/lib/bounded-upload';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const paths = await listDriveFolders({ userId: session.user.id, workspaceId: session.workspace.id });
    return NextResponse.json({ paths });
  } catch {
    return NextResponse.json({ error: 'Folders are temporarily unavailable. Try again.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let input;
  try { input = await new Response(boundedBodyStream(request, 4096, { timeoutMs: 10_000 })).json(); }
  catch { return NextResponse.json({ error: 'Invalid folder request (maximum 4 KB).' }, { status: 400 }); }
  if (input?.storageId !== undefined && (typeof input.storageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.storageId))) {
    return NextResponse.json({ error: 'Invalid storage destination.' }, { status: 400 });
  }
  const path = input?.path;
  if (input?.expectedWorkspaceId && input.expectedWorkspaceId !== session.workspace.id) {
    return NextResponse.json({ error: 'Workspace changed. Return to the intended workspace and try again.' }, { status: 409 });
  }
  if (typeof path !== 'string' || !path || Buffer.byteLength(path) > 1024 || path.split('/').length > 16 ||
    path.split('/').some((s) => !s || s === '.' || s === '..' || s.trim() !== s || Buffer.byteLength(s) > 180 || /[\x00-\x1f\x7f\\:<>"|?*]/.test(s))) {
    return NextResponse.json({ error: 'Choose a valid folder name (up to 180 bytes, no path or reserved characters).' }, { status: 400 });
  }
  try {
    const actor = { userId: session.user.id, workspaceId: session.workspace.id };
    if (typeof input.storageId === 'string') await createCloudStorageFolder(actor, input.storageId, path);
    else await createDriveFolder(actor, path);
    return NextResponse.json({ path });
  } catch {
    return NextResponse.json({ error: 'Could not create the folder. Check storage availability and try again.' }, { status: 503 });
  }
}
