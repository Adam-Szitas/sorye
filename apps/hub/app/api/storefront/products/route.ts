import { ensureHubUser } from '@/lib/ensure-user';
import { listRodrigoResources, RodrigoResponseError } from '@/lib/rodrigo/service-client';
import { deriveActionQueueScope } from '@/lib/rodrigo/queue-scope';
import { cloneStorefrontSeedProducts, type StorefrontProduct } from '@sorye/types';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('storefront')) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  try {
    const page = await listRodrigoResources({ userId: session.user.id, workspaceId: session.workspace.id }, 'storefront', 'product', 100);
    const revisions = Object.fromEntries(page.items.map(({ resourceId, revision }) => [resourceId, revision]));
    const products: StorefrontProduct[] = page.items.filter(({ resource }) => resource.active === true && resource.currency === 'USD').map(({ resource }) => ({
      id: String(resource.id), title: String(resource.title ?? resource.name),
      summary: String(resource.summary ?? String(resource.description).slice(0, 240)),
      description: String(resource.description), priceCents: Number(resource.priceCents ?? resource.priceMinor),
      category: String(resource.category ?? 'General'), accent: String(resource.accent ?? '#f472b6'),
    }));
    const queueScope = deriveActionQueueScope('storefront', session.user.id, session.workspace.id);
    return NextResponse.json({ products: products.length ? products : cloneStorefrontSeedProducts(), revisions, queueScope, canManage: session.workspace.ownerId === session.user.id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof RodrigoResponseError ? error.status : 503;
    const code = error instanceof RodrigoResponseError ? error.code : 'rodrigo_unavailable';
    return NextResponse.json({ error: { code } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

/** Legacy direct writes are disabled; product edits use the queued v2 batch API. */
export async function POST() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  return NextResponse.json({ error: { code: 'legacy_writer_disabled' } }, { status: 410 });
}
