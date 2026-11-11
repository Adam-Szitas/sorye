import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { noStore } from '@/lib/upload-storage/http';
import { getOwnStorageSnapshot } from '@/lib/upload-storage/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Own-storage settings of the active workspace. Never contains credentials. */
export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  return NextResponse.json(await getOwnStorageSnapshot(session), { headers: noStore });
}
