import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { getRodrigoResource, RodrigoResponseError } from '@/lib/rodrigo/service-client';

const types: Record<string, readonly string[]> = {
  tasks: ['task', 'taskBoard'], notes: ['note'], calendar: ['event'], workspace: ['settings'], messenger: ['channel', 'message', 'reaction'],
  files: ['fileMetadata'], canvas: ['board'], mail: ['account', 'draft'], relay: ['config'], site: ['page'], storefront: ['product', 'order'],
  ocr: ['analysis', 'pattern'], studio: ['project'], notifications: ['notification'], events: ['event'], embed: ['widget'], protocolio: ['artifact'],
};
export async function GET(_request: Request, { params }: { params: Promise<{ appId: string; resourceType: string; resourceId: string }> }) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  const { appId, resourceType, resourceId } = await params;
  if (!Object.hasOwn(types, appId) || !types[appId as keyof typeof types].includes(resourceType as never) || resourceId.length < 1 || resourceId.length > 160) {
    return NextResponse.json({ error: { code: 'invalid_resource' } }, { status: 400 });
  }
  if (appId === 'messenger') return NextResponse.json({ error: { code: 'scoped_resource_route_required' } }, { status: 403 });
  const workspaceOwnerRead = appId === 'workspace' && resourceType === 'settings' && session.workspace.ownerId === session.user.id;
  if (!session.workspace.memberIds.includes(session.user.id) || (!workspaceOwnerRead && !session.workspace.selectedAppIds.includes(appId))) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  if (appId === 'storefront' && resourceType === 'order' && session.workspace.ownerId !== session.user.id) {
    return NextResponse.json({ error: { code: 'operation_forbidden' } }, { status: 403 });
  }
  try {
    const snapshot = await getRodrigoResource({ userId: session.user.id, workspaceId: session.workspace.id }, appId as never, resourceType as never, resourceId);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof RodrigoResponseError ? error.status : 503;
    const code = error instanceof RodrigoResponseError ? error.code : 'rodrigo_unavailable';
    const requestId = error instanceof RodrigoResponseError ? error.requestId : undefined;
    return NextResponse.json({ error: { code, ...(requestId ? { requestId } : {}) } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
