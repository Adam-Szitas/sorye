import { ensureHubUser } from '@/lib/ensure-user';
import { CloudStorageError, deleteCloudStorage, rotateCloudStorageCredentials } from '@/lib/cloud-storage';
import { assertJsonPayloadSize } from '@/lib/security-limits';
import { assertRateLimit, mailRateKey } from '@/lib/mail-rate-limit';
import { NextResponse } from 'next/server';

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isAdmin) return NextResponse.json({ error: 'Only Sorye admins can remove storage.' }, { status: 403 });
  try {
    assertRateLimit(mailRateKey(session.workspace.id, session.user.id, 'storage-remove'), 5, 10 * 60_000, 'Too many storage changes. Try again in a few minutes.');
    const { id } = await context.params;
    await deleteCloudStorage(session.workspace.id, id);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    const limited = error instanceof Error && error.message.startsWith('Too many');
    const safe = error instanceof CloudStorageError ? error : new CloudStorageError(limited ? error.message : 'Could not remove storage.', limited ? 429 : 500);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isAdmin) return NextResponse.json({ error: 'Only Sorye admins can rotate storage credentials.' }, { status: 403 });
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    assertJsonPayloadSize(body, 8_000, 'Storage credentials');
    assertRateLimit(mailRateKey(session.workspace.id, session.user.id, 'storage-rotate'), 5, 10 * 60_000, 'Too many credential changes. Try again in a few minutes.');
    await rotateCloudStorageCredentials(session.workspace.id, id, body.accessKeyId, body.secretAccessKey);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) {
    const safe = error instanceof CloudStorageError ? error : new CloudStorageError(error instanceof Error && error.message.startsWith('Too many') ? error.message : 'Could not rotate credentials.', error instanceof Error && error.message.startsWith('Too many') ? 429 : 400);
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
