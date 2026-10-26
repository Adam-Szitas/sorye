import { ensureHubUser } from '@/lib/ensure-user';
import { CloudStorageError, connectCloudStorage, listCloudStorages } from '@/lib/cloud-storage';
import { assertJsonPayloadSize } from '@/lib/security-limits';
import { assertRateLimit, mailRateKey } from '@/lib/mail-rate-limit';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
const noStore = { 'Cache-Control': 'no-store, private' };

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  return NextResponse.json({
    storages: await listCloudStorages(session.workspace.id),
    canManage: session.user.isAdmin === true,
    available: Boolean(process.env.STORAGE_SECRET_KEY && process.env.STORAGE_SECRET_KEY.trim().length >= 32),
  }, { headers: noStore });
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  if (!session.user.isAdmin) return NextResponse.json({ error: 'Only Sorye admins can connect storage.' }, { status: 403, headers: noStore });

  try {
    assertRateLimit(mailRateKey(session.workspace.id, session.user.id, 'storage-connect'), 5, 10 * 60_000, 'Too many storage connection attempts. Try again in a few minutes.');
    const body = await req.json();
    assertJsonPayloadSize(body, 8_000, 'Storage connection');
    const storage = await connectCloudStorage({ ...body, workspaceId: session.workspace.id });
    return NextResponse.json({ storage }, { status: 201, headers: noStore });
  } catch (error) {
    const limited = error instanceof Error && error.message.startsWith('Too many');
    const safe = error instanceof CloudStorageError
      ? error
      : new CloudStorageError(limited ? error.message : 'Could not connect storage. Check the details and try again.', limited ? 429 : 400);
    return NextResponse.json({ error: safe.message }, { status: safe.status, headers: noStore });
  }
}
