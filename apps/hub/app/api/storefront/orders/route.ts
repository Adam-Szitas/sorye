import { ensureHubUser } from '@/lib/ensure-user';
import { listRodrigoResourcesBounded, RodrigoResponseError } from '@/lib/rodrigo/service-client';
import type { StorefrontOrder } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('storefront')) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  try {
    const context = { userId: session.user.id, workspaceId: session.workspace.id };
    const [orderItems, productItems] = await Promise.all([
      listRodrigoResourcesBounded(context, 'storefront', 'order'),
      listRodrigoResourcesBounded(context, 'storefront', 'product'),
    ]);
    const byId = new Map(productItems.map(({ resource }) => [String(resource.id), resource]));
    const orders: StorefrontOrder[] = orderItems.flatMap(({ resource, createdByUserId }) => {
      // Ownership is the verified actor stored beside the payload, never a client field.
      if (createdByUserId !== session.user.id || resource.status !== 'requested' || !Array.isArray(resource.items)) return [];
      const items = resource.items.flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const item = value as Record<string, unknown>;
        const product = byId.get(String(item.productId));
        const quantity = Number(item.quantity);
        const unitPriceCents = Number(item.unitPriceMinor);
        if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(unitPriceCents)) return [];
        return [{ productId: String(item.productId), title: String(product?.name ?? product?.title ?? item.productId), quantity, unitPriceCents }];
      });
      if (items.length === 0) return [];
      const totalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
      return [{
        id: String(resource.id), workspaceId: session.workspace.id, userId: session.user.id,
        userName: String(resource.customerName ?? session.user.displayName), status: 'enquiry' as const, items,
        note: typeof resource.note === 'string' ? resource.note : '', totalCents, createdAt: String(resource.createdAt),
      }];
    });
    return NextResponse.json({ orders, workspace: { id: session.workspace.id, name: session.workspace.name, memberIds: session.workspace.memberIds, selectedAppIds: session.workspace.selectedAppIds } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof RodrigoResponseError ? error.status : 503;
    const code = error instanceof RodrigoResponseError ? error.code : 'rodrigo_unavailable';
    return NextResponse.json({ error: { code } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

/** Legacy direct writes are disabled. Enquiries are queued and submitted to /api/backend/actions/batch. */
export async function POST() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  return NextResponse.json({ error: { code: 'legacy_writer_disabled' } }, { status: 410 });
}
