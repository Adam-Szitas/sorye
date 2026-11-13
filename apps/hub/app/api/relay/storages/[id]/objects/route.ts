import { ensureHubUser } from '@/lib/ensure-user';
import { FileAccessError, resolveWorkspaceFileMime, sanitizeDisplayName } from '@/lib/files';
import { MultipartError, parseMultipartUpload } from '@/lib/multipart-stream';
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
    const objects = await listCloudStorageObjects({ userId: session.user.id, workspaceId: session.workspace.id }, id, prefix);
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
    if (!req.body) throw new CloudStorageError('Choose a file to upload.');
    // Streamed: the file part flows to Rodrigo; Hub never holds the whole file.
    let upload;
    try {
      upload = await parseMultipartUpload(req.body, req.headers.get('content-type'));
    } catch (error) {
      throw new CloudStorageError(error instanceof MultipartError && error.reason === 'no_file' ? 'Choose a file to upload.' : 'Expected multipart form data.');
    }
    const prefix = upload.fields.get('prefix');
    if (upload.fileField !== 'file') { await upload.cancel(); throw new CloudStorageError('Choose a file to upload.'); }
    const rawName = upload.fileName.replace(/\\/g, '/').split('/').pop()?.trim().replace(/[\u0000-\u001f\u007f]/g, '') ?? '';
    if (!rawName || rawName === '.' || rawName === '..' || rawName.length > 180) throw new CloudStorageError('File name is invalid.');
    const name = sanitizeDisplayName(rawName);
    const safePrefix = typeof prefix === 'string' ? prefix : '';
    const key = `${safePrefix}${name}`;
    // Sniff the first bytes for the blocked-type policy, then replay them in front of the rest.
    const iterator = upload.file[Symbol.asyncIterator]();
    const head: Buffer[] = [];
    let headSize = 0;
    let ended = false;
    while (headSize < 8192) {
      const next = await iterator.next();
      if (next.done) { ended = true; break; }
      head.push(Buffer.from(next.value));
      headSize += next.value.byteLength;
    }
    const first = Buffer.concat(head, headSize);
    const contentType = resolveWorkspaceFileMime(first, name);
    async function* replay(): AsyncIterable<Uint8Array> {
      if (first.length) yield first;
      if (ended) return;
      for (;;) { const next = await iterator.next(); if (next.done) return; yield next.value; }
    }
    const stored = await putCloudStorageObject({ userId: session.user.id, workspaceId: session.workspace.id }, id, key, replay(), contentType, { maxBytes: Math.min(FILE_MAX_BYTES, contentLength || FILE_MAX_BYTES) });
    return NextResponse.json({ ok: true, key, name, size: stored.size }, { status: 201, headers: noStore });
  } catch (error) { return responseError(error); }
}
