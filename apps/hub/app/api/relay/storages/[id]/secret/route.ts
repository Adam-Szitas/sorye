import { ensureHubUser } from '@/lib/ensure-user';
import { CloudStorageError, getCloudStorageSecrets } from '@/lib/cloud-storage';
import { assertRateLimit, mailRateKey } from '@/lib/mail-rate-limit';
import { NextResponse } from 'next/server';

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isAdmin) return NextResponse.json({ error: 'Only Sorye admins can reveal storage credentials.' }, { status: 403 });
  const headers = {
    'Cache-Control': 'no-store, private', Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  };
  try {
    assertRateLimit(mailRateKey(session.workspace.id, session.user.id, 'storage-secret-reveal'), 5, 10 * 60_000, 'Too many credential reveal attempts. Try again in a few minutes.');
    const { id } = await context.params;
    const secrets = await getCloudStorageSecrets(session.workspace.id, id);
    return NextResponse.json(secrets, { headers });
  } catch (error) {
    const limited = error instanceof Error && error.message.startsWith('Too many');
    const safe = error instanceof CloudStorageError
      ? error
      : new CloudStorageError(limited ? error.message : 'Could not reveal storage credentials.', limited ? 429 : 500);
    return NextResponse.json({ error: safe.message }, { status: safe.status, headers });
  }
}
