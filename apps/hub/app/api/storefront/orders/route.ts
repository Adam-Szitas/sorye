import { ensureHubUser } from '@/lib/ensure-user';
import { publishWorkspaceEvent } from '@/lib/events';
import { assertJsonPayloadSize, MAX_STOREFRONT_ORDER_BYTES } from '@/lib/security-limits';
import { listStorefrontOrders, placeStorefrontOrder } from '@/lib/storefront';
import { formatStorefrontPrice, type PlaceStorefrontOrderInput } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mine = new URL(req.url).searchParams.get('mine') === '1';
  const orders = await listStorefrontOrders(session.workspace.id, {
    userId: mine ? session.user.id : undefined,
  });
  return NextResponse.json({ orders });
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<PlaceStorefrontOrderInput>;

  try {
    assertJsonPayloadSize(body, MAX_STOREFRONT_ORDER_BYTES, 'Order');
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Payload too large' },
      { status: 400 },
    );
  }

  let order;
  try {
    order = await placeStorefrontOrder({
      workspaceId: session.workspace.id,
      userId: session.user.id,
      userName: session.user.displayName,
      body: {
        items: Array.isArray(body.items) ? body.items : [],
        note: body.note,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not place order' },
      { status: 400 },
    );
  }

  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  await publishWorkspaceEvent({
    userId: session.user.id,
    workspaceId: session.workspace.id,
    name: 'sorye.storefront.order_placed',
    payload: {
      title: 'Order request placed',
      summary: `${itemCount} item${itemCount === 1 ? '' : 's'} · ${formatStorefrontPrice(order.totalCents)} enquiry`,
      appId: 'storefront',
      entityId: order.id,
      meta: {
        orderId: order.id,
        itemCount,
        totalCents: order.totalCents,
      },
    },
  });

  return NextResponse.json({ order }, { status: 201 });
}
