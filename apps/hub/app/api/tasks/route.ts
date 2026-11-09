import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createDefaultTasksBoard } from '@sorye/types';
import { ensureHubUser } from '@/lib/ensure-user';
import { getRodrigoResource, RodrigoResponseError } from '@/lib/rodrigo/service-client';
import { parseTasksBoard } from '@/lib/workspace-docs-validate';
import { readPartitionedLoad, sessionWorkspace } from '@/lib/user-load-read';

function queueScope(userId: string, workspaceId: string) {
  return createHash('sha256').update(`sorye-tasks-queue-v1\0${userId}\0${workspaceId}`).digest('hex');
}

async function authorize() {
  const session = await ensureHubUser();
  if (!session) return { response: NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 }) };
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('tasks')) {
    return { response: NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const auth = await authorize();
  if ('response' in auth) return auth.response;
  const { session } = auth;
  try {
    const context = { userId: session.user.id, workspaceId: session.workspace.id };
    const snapshot = await getRodrigoResource(context, 'tasks', 'taskBoard', 'main');
    const board = snapshot.resource ? parseTasksBoard(snapshot.resource) : createDefaultTasksBoard();
    const load = await readPartitionedLoad(session, async (scope) => {
      const other = await getRodrigoResource({ userId: session.user.id, workspaceId: scope.id }, 'tasks', 'taskBoard', 'main');
      if (!other.resource) return [];
      return parseTasksBoard(other.resource).tasks.map((task) => ({ workspaceId: scope.id, value: task }));
    }, { appId: 'tasks' });
    return NextResponse.json({
      board, empty: snapshot.resource === null, revision: snapshot.revision,
      queueScope: queueScope(session.user.id, session.workspace.id), load, workspace: sessionWorkspace(session),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof RodrigoResponseError ? error.status : 503;
    const code = error instanceof RodrigoResponseError ? error.code : 'rodrigo_unavailable';
    const requestId = error instanceof RodrigoResponseError ? error.requestId : undefined;
    return NextResponse.json({ error: { code, ...(requestId ? { requestId } : {}) } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

/** The legacy whole-document writer is disabled. Tasks mutations use v2 action batches. */
export async function PUT() {
  const auth = await authorize();
  if ('response' in auth) return auth.response;
  return NextResponse.json({ error: { code: 'legacy_writer_disabled' } }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
