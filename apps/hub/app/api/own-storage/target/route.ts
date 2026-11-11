import { isUploadTarget } from '@sorye/types';
import { ownStorageWrite, readBody, resultResponse } from '@/lib/upload-storage/http';
import { setTarget } from '@/lib/upload-storage/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Choose where new uploads go: Sorye storage, your drive, or your database. */
export async function PUT(req: Request) {
  const body = await readBody(req);
  if (!body || !isUploadTarget(body.target) || Object.keys(body).length !== 1) return resultResponse({ ok: false, code: 'invalid_input' });
  const target = body.target;
  return ownStorageWrite('target', 20, (session) => setTarget(session, target));
}
