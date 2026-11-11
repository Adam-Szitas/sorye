import { NextResponse } from 'next/server';
import { noStore, ownStorageWrite, readBody, resultResponse } from '@/lib/upload-storage/http';
import { checkConnection, connectDatabase, connectDrive, disconnect, setLimit } from '@/lib/upload-storage/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ kind: string }> };

async function targetOf(context: Context): Promise<'drive' | 'database' | null> {
  const { kind: target } = await context.params;
  return target === 'drive' || target === 'database' ? target : null;
}

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore });

/** Connect, or replace the credentials of, the drive or database. Verified before it is saved. */
export async function PUT(req: Request, context: Context) {
  const target = await targetOf(context);
  if (!target) return notFound();
  const body = await readBody(req);
  if (!body) return resultResponse({ ok: false, code: 'invalid_input' });
  return ownStorageWrite(`connect-${target}`, 8, (session) =>
    target === 'drive' ? connectDrive(session, body) : connectDatabase(session, body));
}

/** Change the storage limit. */
export async function PATCH(req: Request, context: Context) {
  const target = await targetOf(context);
  if (!target) return notFound();
  const body = await readBody(req);
  if (!body) return resultResponse({ ok: false, code: 'invalid_input' });
  return ownStorageWrite(`limit-${target}`, 20, (session) => setLimit(session, target, body.limitGb));
}

/** Re-test the saved connection. */
export async function POST(_req: Request, context: Context) {
  const target = await targetOf(context);
  if (!target) return notFound();
  return ownStorageWrite(`check-${target}`, 20, (session) => checkConnection(session, target));
}

/** Remove the connection and its credentials. Refused while uploads go there or files are stored there. */
export async function DELETE(_req: Request, context: Context) {
  const target = await targetOf(context);
  if (!target) return notFound();
  return ownStorageWrite(`disconnect-${target}`, 8, (session) => disconnect(session, target));
}
