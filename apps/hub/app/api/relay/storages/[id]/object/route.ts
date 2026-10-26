import { ensureHubUser } from '@/lib/ensure-user';
import {
  CloudStorageError,
  getCloudStorageObject,
} from '@/lib/cloud-storage';
import { NextResponse } from 'next/server';
import { assertRateLimit, mailRateKey } from '@/lib/mail-rate-limit';

export const runtime = 'nodejs';
const noStore = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  try {
    assertRateLimit(mailRateKey(session.workspace.id, session.user.id, 'storage-download'), 20, 10 * 60_000, 'Too many cloud downloads. Try again in a few minutes.');
    const { id } = await context.params;
    const key = new URL(req.url).searchParams.get('key') ?? '';
    const object = await getCloudStorageObject(session.workspace.id, id, key);
    const name = key.split('/').pop() ?? 'download';
    const safeName = name.replace(/[\r\n"\\]/g, '_');
    return new NextResponse(object.bytes, { headers: {
      ...noStore,
      'Content-Type': /^[\w.+-]+\/[\w.+-]+$/.test(object.contentType) ? object.contentType : 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    } });
  } catch (error) {
    const limited = error instanceof Error && error.message.startsWith('Too many');
    const safe = error instanceof CloudStorageError ? error : new CloudStorageError(limited ? error.message : 'Could not download file.', limited ? 429 : 502);
    return NextResponse.json({ error: safe.message }, { status: safe.status, headers: noStore });
  }
}

