import { ensureHubUser } from '@/lib/ensure-user';
import { FileAccessError, resolveWorkspaceFileMime, sanitizeDisplayName } from '@/lib/files';
import {
  CloudStorageError,
  listCloudStorageObjects,
  putCloudStorageObject,
} from '@/lib/cloud-storage';
import { FILE_MAX_BYTES } from '@sorye/types';
import { assertRateLimit, mailRateKey } from '@/lib/mail-rate-limit';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
const noStore = { 'Cache-Control': 'no-store, private' };

function responseError(error: unknown) {
  if (error instanceof FileAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: noStore });
  }
  const limited = error instanceof Error && error.message.startsWith('Too many');
  const safe = error instanceof CloudStorageError ? error : new CloudStorageError(limited ? error.message : 'Cloud storage request failed.', limited ? 429 : 502);
  return NextResponse.json({ error: safe.message }, { status: safe.status, headers: noStore });
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  try {
    assertRateLimit(mailRateKey(session.workspace.id, session.user.id, 'storage-list'), 120, 60_000, 'Too many cloud folder requests. Wait a moment and try again.');
    const { id } = await context.params;
    const prefix = new URL(req.url).searchParams.get('prefix') ?? '';
    const objects = await listCloudStorageObjects(session.workspace.id, id, prefix);
    return NextResponse.json({ objects }, { headers: noStore });
  } catch (error) { return responseError(error); }
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  try {
    assertRateLimit(mailRateKey(session.workspace.id, session.user.id, 'storage-upload'), 10, 10 * 60_000, 'Too many cloud uploads. Try again in a few minutes.');
    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (contentLength > FILE_MAX_BYTES + 1_000_000) throw new CloudStorageError('File is too large (maximum 64 MB).', 413);
    const { id } = await context.params;
    const form = await req.formData();
    const file = form.get('file');
    const prefix = form.get('prefix');
    if (!(file instanceof File)) throw new CloudStorageError('Choose a file to upload.');
    if (file.size > FILE_MAX_BYTES) throw new CloudStorageError('File is too large (maximum 64 MB).', 413);
    const rawName = file.name.replace(/\\/g, '/').split('/').pop()?.trim().replace(/[\u0000-\u001f\u007f]/g, '') ?? '';
    if (!rawName || rawName === '.' || rawName === '..' || rawName.length > 180) throw new CloudStorageError('File name is invalid.');
    const name = sanitizeDisplayName(rawName);
    const safePrefix = typeof prefix === 'string' ? prefix : '';
    const key = `${safePrefix}${name}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length > FILE_MAX_BYTES) throw new CloudStorageError('File is too large (maximum 64 MB).', 413);
    const contentType = resolveWorkspaceFileMime(bytes, name);
    await putCloudStorageObject(session.workspace.id, id, key, bytes, contentType);
    return NextResponse.json({ ok: true, key, name, size: bytes.length }, { status: 201, headers: noStore });
  } catch (error) { return responseError(error); }
}
