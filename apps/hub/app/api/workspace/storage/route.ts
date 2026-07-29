import { ensureHubUser } from '@/lib/ensure-user';
import { getHubDefaultDriver } from '@/lib/workspace-db';
import {
  clearWorkspaceStorage,
  getWorkspaceStoragePublic,
  getWorkspaceStorageRecord,
  setWorkspacePostgresUrl,
} from '@/lib/store/workspace-storage';
import { testPostgresConnection } from '@/lib/workspace-storage-util';
import type { WorkspaceStorageInfo } from '@sorye/types';
import { NextResponse } from 'next/server';

async function buildStorageInfo(
  workspaceId: string,
): Promise<WorkspaceStorageInfo> {
  const record = await getWorkspaceStorageRecord(workspaceId);
  return {
    ...getWorkspaceStoragePublic(record),
    hubDefaultDriver: getHubDefaultDriver(),
  };
}

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storage = await buildStorageInfo(session.workspace.id);
  return NextResponse.json({ storage });
}

export async function PUT(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as { databaseUrl?: string };
  const databaseUrl = body.databaseUrl?.trim();
  if (!databaseUrl) {
    return NextResponse.json(
      { error: 'databaseUrl is required' },
      { status: 400 },
    );
  }

  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
    return NextResponse.json(
      { error: 'Only PostgreSQL connection strings are supported' },
      { status: 400 },
    );
  }

  try {
    await setWorkspacePostgresUrl(session.workspace.id, databaseUrl);
    const storage = await buildStorageInfo(session.workspace.id);
    return NextResponse.json({ storage });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Could not save database URL',
      },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as { action?: string; databaseUrl?: string };

  if (body.action === 'test') {
    const databaseUrl = body.databaseUrl?.trim();
    if (!databaseUrl) {
      return NextResponse.json(
        { error: 'databaseUrl is required' },
        { status: 400 },
      );
    }

    const result = await testPostgresConnection(databaseUrl);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function DELETE() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await clearWorkspaceStorage(session.workspace.id);
  const storage = await buildStorageInfo(session.workspace.id);
  return NextResponse.json({ storage });
}
