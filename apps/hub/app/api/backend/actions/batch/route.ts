import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { submitRodrigoActionBatch } from '@/lib/rodrigo/service-client';
import { actionQueueScopeMatches } from '@/lib/rodrigo/queue-scope';
import { viewerPersonalPackageIncludes } from '@/lib/personal-package';
import { actionBatchSchema, hasDuplicateActionIds, readBoundedActionBatchJson } from '@/lib/rodrigo/action-validation';
import { catalogProductsFromResources, orderCustomerMatches, orderItemsMatchCatalog } from '@/lib/rodrigo/order-policy';
import { listRodrigoResourcesBounded, RodrigoResponseError } from '@/lib/rodrigo/service-client';

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  let body: unknown;
  try { body = await readBoundedActionBatchJson(req); }
  catch (error) { return NextResponse.json({ error: { code: error instanceof Error && error.message === 'too_large' ? 'body_limit_exceeded' : 'invalid_json' } }, { status: error instanceof Error && error.message === 'too_large' ? 413 : 400 }); }
  const parsed = actionBatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: 'invalid_action_batch' } }, { status: 400 });
  if (hasDuplicateActionIds(parsed.data.actions)) return NextResponse.json({ error: { code: 'duplicate_action_id_in_batch' } }, { status: 400 });
  const appIds = new Set(parsed.data.actions.map((item) => item.appId));
  const queueScope = req.headers.get('x-sorye-queue-scope') ?? '';
  if (appIds.size !== 1 || !/^[a-f0-9]{64}$/.test(queueScope)) {
    return NextResponse.json({ error: { code: 'queue_scope_required' } }, { status: 400 });
  }
  const appId = parsed.data.actions[0]!.appId;
  if (!actionQueueScopeMatches(queueScope, appId, session.user.id, session.workspace.id)) {
    return NextResponse.json({ error: { code: 'queue_scope_mismatch' } }, { status: 403 });
  }
  for (const item of parsed.data.actions) {
    const enabled = item.appId === 'workspace'
      ? session.workspace.ownerId === session.user.id
      : session.workspace.selectedAppIds.includes(item.appId);
    if (!enabled || !session.workspace.memberIds.includes(session.user.id)) {
      return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
    }
    if (item.appId === 'messenger' && session.workspace.kind === 'personal' && !(await viewerPersonalPackageIncludes(session, 'messenger'))) {
      return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
    }
    if (item.appId === 'storefront' && item.resourceType === 'product' && session.workspace.ownerId !== session.user.id) {
      return NextResponse.json({ error: { code: 'operation_forbidden' } }, { status: 403 });
    }
    if (item.appId === 'storefront' && item.resourceType === 'order' && item.operation !== 'create') {
      return NextResponse.json({ error: { code: 'operation_forbidden' } }, { status: 403 });
    }
    if (item.appId === 'storefront' && item.resourceType === 'order' && !orderCustomerMatches(item.payload, session.user)) {
      return NextResponse.json({ error: { code: 'order_customer_mismatch' } }, { status: 403 });
    }
    if (item.appId === 'site' && item.resourceType === 'page' && session.workspace.ownerId !== session.user.id) {
      return NextResponse.json({ error: { code: 'operation_forbidden' } }, { status: 403 });
    }
    if (item.appId === 'workspace' && (item.resourceType !== 'settings' || item.resourceId !== 'main' || session.workspace.ownerId !== session.user.id)) {
      return NextResponse.json({ error: { code: 'operation_forbidden' } }, { status: 403 });
    }
    if (item.appId === 'messenger' && item.resourceType === 'channel' && item.operation === 'create'
      && ['direct', 'private'].includes(String(item.payload.kind))
      && (!Array.isArray(item.payload.memberIds) || !item.payload.memberIds.includes(session.user.id))) {
      return NextResponse.json({ error: { code: 'channel_membership_invalid' } }, { status: 400 });
    }
    if (item.appId === 'messenger' && item.resourceType === 'channel' && Array.isArray(item.payload.memberIds)
      && item.payload.memberIds.some((memberId) => typeof memberId !== 'string' || !session.workspace.memberIds.includes(memberId))) {
      return NextResponse.json({ error: { code: 'channel_member_outside_workspace' } }, { status: 403 });
    }
    if (item.appId === 'messenger' && item.resourceType === 'message' && Array.isArray(item.payload.mentionUserIds)
      && item.payload.mentionUserIds.some((memberId) => typeof memberId !== 'string' || !session.workspace.memberIds.includes(memberId))) {
      return NextResponse.json({ error: { code: 'mention_user_outside_workspace' } }, { status: 403 });
    }
  }
  const orderCreates = parsed.data.actions.filter((item) => item.appId === 'storefront' && item.resourceType === 'order');
  if (orderCreates.length > 0) {
    try {
      const products = catalogProductsFromResources(await listRodrigoResourcesBounded(
        { userId: session.user.id, workspaceId: session.workspace.id }, 'storefront', 'product',
      ));
      if (orderCreates.some((item) => !orderItemsMatchCatalog(item.payload.items, products))) {
        return NextResponse.json({ error: { code: 'price_mismatch' } }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      }
    } catch (error) {
      const status = error instanceof RodrigoResponseError ? error.status : 503;
      const code = error instanceof RodrigoResponseError ? error.code : 'rodrigo_unavailable';
      return NextResponse.json({ error: { code } }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
  }
  try {
    const result = await submitRodrigoActionBatch({ userId: session.user.id, workspaceId: session.workspace.id }, parsed.data);
    const expectedIds = new Set(parsed.data.actions.map((item) => item.actionId));
    const resultIds = new Set(result.results.map((item) => item.actionId));
    if (result.results.length !== parsed.data.actions.length || resultIds.size !== result.results.length
      || resultIds.size !== expectedIds.size || [...resultIds].some((id) => !expectedIds.has(id))) {
      return NextResponse.json({ error: { code: 'invalid_rodrigo_response' } }, { status: 502 });
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 503;
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'rodrigo_unavailable';
    const requestId = error instanceof Error && 'requestId' in error ? error.requestId : undefined;
    return NextResponse.json({ error: { code, ...(requestId ? { requestId } : {}) } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
