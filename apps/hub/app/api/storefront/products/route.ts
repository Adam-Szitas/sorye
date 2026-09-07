import { ensureHubUser } from '@/lib/ensure-user';
import { assertJsonPayloadSize, MAX_STOREFRONT_PRODUCT_BYTES } from '@/lib/security-limits';
import {
  listStorefrontProducts,
  upsertStorefrontProduct,
} from '@/lib/storefront';
import type { UpsertStorefrontProductInput } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const products = await listStorefrontProducts(session.workspace.id);
  return NextResponse.json({ products });
}

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<UpsertStorefrontProductInput>;

  try {
    assertJsonPayloadSize(body, MAX_STOREFRONT_PRODUCT_BYTES, 'Product');
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Payload too large' },
      { status: 400 },
    );
  }

  if (!body.title || body.priceCents == null) {
    return NextResponse.json(
      { error: 'title and priceCents are required' },
      { status: 400 },
    );
  }

  try {
    const product = await upsertStorefrontProduct(session.workspace.id, {
      id: body.id,
      title: body.title,
      summary: body.summary,
      description: body.description,
      priceCents: body.priceCents,
      category: body.category,
      accent: body.accent,
    });
    return NextResponse.json({ product }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not save product' },
      { status: 400 },
    );
  }
}
