import { ensureHubUser } from '@/lib/ensure-user';
import { getHubDefaultDriver } from '@/lib/workspace-db';
import {
  clearWorkspaceStorage,
  getWorkspaceStoragePublic,
  getWorkspaceStorageRecord,
  setWorkspacePostgresUrl,
} from '@/lib/store/workspace-storage';
import { assertRateLimit } from '@/lib/mail-rate-limit';
import { testPostgresConnection } from '@/lib/workspace-storage-util';
import { ownStorageAllowed, type HubSession, type WorkspaceStorageInfo } from '@sorye/types';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Workspace app-data database (Canvas, Messenger, OCR records).
 * Only the workspace owner on a plan with own storage may change it; the
 * workspace comes from the session; failures return fixed messages only.
 */

const noStore = { 'Cache-Control': 'private, no-store' };
const MAX_URL_CHARS = 2_048;

async function buildStorageInfo(
  workspaceId: string,
): Promise<WorkspaceStorageInfo> {
  const record = await getWorkspaceStorageRecord(workspaceId);
  return {
    ...getWorkspaceStoragePublic(record),
    hubDefaultDriver: getHubDefaultDriver(),
  };
}

function denied(session: HubSession, needsPlan: boolean): NextResponse | null {
  if (session.workspace.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Only the workspace owner can change the workspace database.' }, { status: 403, headers: noStore });
  }
  if (needsPlan && !ownStorageAllowed(session.workspace.subscriptionId)) {
    return NextResponse.json({ error: 'Your own database is part of the Pro and Enterprise plans.' }, { status: 403, headers: noStore });
  }
  try {
    assertRateLimit(`workspace-db:${session.workspace.id}:${session.user.id}`, 10, 10 * 60_000);
  } catch {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429, headers: noStore });
  }
  return null;
}

async function readUrl(req: Request): Promise<string | null> {
  const text = await req.text().catch(() => '');
  if (text.length > MAX_URL_CHARS + 200) return null;
  try {
    const body = JSON.parse(text) as { databaseUrl?: unknown };
    const url = typeof body.databaseUrl === 'string' ? body.databaseUrl.trim() : '';
    if (!url || url.length > MAX_URL_CHARS) return null;
    if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) return null;
    return url;
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  }

  const storage = await buildStorageInfo(session.workspace.id);
  return NextResponse.json({ storage }, { headers: noStore });
}

export async function PUT(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  }
  const refusal = denied(session, true);
  if (refusal) return refusal;

  const databaseUrl = await readUrl(req);
  if (!databaseUrl) {
    return NextResponse.json({ error: 'Enter a PostgreSQL connection string (postgres:// or postgresql://).' }, { status: 400, headers: noStore });
  }

  try {
    await setWorkspacePostgresUrl(session.workspace.id, databaseUrl);
    const storage = await buildStorageInfo(session.workspace.id);
    return NextResponse.json({ storage }, { headers: noStore });
  } catch (err) {
    // testPostgresConnection already produced a fixed message; anything else stays generic.
    const message = err instanceof Error && err.message.length < 200 && !/\n/.test(err.message) ? err.message : 'Could not save the database connection.';
    return NextResponse.json({ error: message }, { status: 400, headers: noStore });
  }
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  }
  const refusal = denied(session, true);
  if (refusal) return refusal;

  const text = await req.clone().text().catch(() => '');
  let action: unknown;
  try {
    action = (JSON.parse(text) as { action?: unknown }).action;
  } catch {
    action = undefined;
  }
  if (action !== 'test') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: noStore });
  }
  const databaseUrl = await readUrl(req);
  if (!databaseUrl) {
    return NextResponse.json({ error: 'Enter a PostgreSQL connection string (postgres:// or postgresql://).' }, { status: 400, headers: noStore });
  }
  const result = await testPostgresConnection(databaseUrl);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400, headers: noStore });
  }
  return NextResponse.json({ ok: true }, { headers: noStore });
}

export async function DELETE() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  }
  // Switching back to Sorye's database stays possible after a downgrade.
  const refusal = denied(session, false);
  if (refusal) return refusal;

  await clearWorkspaceStorage(session.workspace.id);
  const storage = await buildStorageInfo(session.workspace.id);
  return NextResponse.json({ storage }, { headers: noStore });
}
