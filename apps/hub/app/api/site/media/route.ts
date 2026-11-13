import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { imageSize, MEDIA_TYPES } from '@sorye/site-sdk';
import { boundedBodyStream, UploadLimitError, withUploadSlot } from '@/lib/bounded-upload';
import { parseClientSha256 } from '@/lib/files-policy';
import { MultipartError, parseMultipartUpload } from '@/lib/multipart-stream';
import { ObjectUploadError, uploadObject } from '@/lib/rodrigo/objects-client';
import { rodrigoContext, rodrigoFailure, siteSession, sniffMediaType } from '@/lib/site-cms/owner';

/**
 * Site media upload (owner only), called by Hub's upload queue with the same multipart
 * fields as Drive. The type is sniffed from the bytes (SVG and unknown types refused),
 * the size is bounded per type, bytes stream to Rodrigo as a `site` object with the
 * browser SHA-256 checked, and image dimensions are read from the bytes. The member's
 * browser then records the `site.media` entry through the action queue; Rodrigo checks
 * that entry against this object.
 */
export const runtime = 'nodejs';

const HEAD_BYTES = 64 * 1024;
const MAX_ANY = Math.max(...Object.values(MEDIA_TYPES));

function fail(status: number, code: string, error: string, headers?: HeadersInit) {
  return NextResponse.json({ error, code, corrupted: code === 'checksum_mismatch' || code === 'integrity_failed' }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export async function POST(req: Request) {
  const gate = await siteSession({ write: true });
  if ('response' in gate) return gate.response;
  const { session } = gate;
  try {
    return await withUploadSlot(() => upload(req, session));
  } catch (error) {
    if (error instanceof UploadLimitError) {
      if (error.status === 429) return fail(429, 'busy', 'Upload slots are busy.', { 'Retry-After': '3' });
      if (error.status === 413) return fail(413, 'too_large', 'The file is too large.');
      return fail(error.status, 'rejected', error.message);
    }
    return rodrigoFailure(error);
  }
}

async function upload(req: Request, session: Parameters<typeof rodrigoContext>[0]) {
  let parsed;
  try {
    parsed = await parseMultipartUpload(boundedBodyStream(req, MAX_ANY + 1_000_000, { timeoutMs: 10 * 60_000 }), req.headers.get('content-type'));
  } catch (error) {
    if (error instanceof UploadLimitError) throw error;
    return fail(400, 'rejected', error instanceof MultipartError ? 'Expected one file.' : 'Expected multipart form data.');
  }
  const expectedWorkspaceId = parsed.fields.get('expectedWorkspaceId');
  if (expectedWorkspaceId && expectedWorkspaceId !== session.workspace.id) {
    await parsed.cancel();
    return fail(409, 'workspace_changed', 'The active workspace changed after this file was queued. Switch back and retry.');
  }
  const sha256 = parseClientSha256(parsed.fields.get('sha256') ?? null);
  if (sha256 === null || parsed.fileField !== 'file') {
    await parsed.cancel();
    return fail(400, 'rejected', 'A file and a valid SHA-256 are required.');
  }

  // Hold the first bytes to learn the type and image size, then stream the rest through.
  const iterator = parsed.file[Symbol.asyncIterator]();
  const head: Uint8Array[] = [];
  let headSize = 0;
  let ended = false;
  while (headSize < HEAD_BYTES) {
    const next = await iterator.next();
    if (next.done) { ended = true; break; }
    head.push(next.value);
    headSize += next.value.length;
  }
  const headBytes = Buffer.concat(head);
  const contentType = sniffMediaType(headBytes);
  if (!contentType || MEDIA_TYPES[contentType] === undefined) {
    await parsed.cancel();
    return fail(415, 'unsupported_type', 'Use a JPEG, PNG, WebP, GIF, AVIF image or a PDF.');
  }
  const size = contentType.startsWith('image/') ? imageSize(headBytes) : { width: 0, height: 0 };
  const image = contentType.startsWith('image/');
  if (!size || (image && (size.width < 1 || size.height < 1)) || size.width > 20000 || size.height > 20000) {
    await parsed.cancel();
    return fail(422, 'unreadable_image', 'The image size could not be read.');
  }
  async function* source() {
    for (const chunk of head) yield chunk;
    if (ended) return;
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  }
  const objectId = randomUUID();
  try {
    const meta = await uploadObject(rodrigoContext(session), {
      objectId, purpose: 'site', contentType, maxBytes: MEDIA_TYPES[contentType]!,
      ...(sha256 ? { sha256 } : {}),
    }, source());
    const name = (parsed.fileName || 'file').replace(/[\u0000-\u001f\u007f/\\]/g, '').slice(0, 255) || 'file';
    return NextResponse.json({
      media: { objectId: meta.objectId, name, contentType, sizeBytes: meta.size, width: size.width, height: size.height, sha256: meta.sha256 },
      verified: Boolean(sha256),
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    await parsed.cancel().catch(() => undefined);
    if (error instanceof ObjectUploadError) {
      const tooLarge = error.code === 'object_too_large';
      return fail(tooLarge ? 413 : 422, error.code, tooLarge ? 'The file is larger than allowed for its type.' : 'The file was damaged in transfer. Retry it.');
    }
    throw error;
  }
}
