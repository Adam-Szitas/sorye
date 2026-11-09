import { ensureHubUser } from '@/lib/ensure-user';
import { getRodrigoResource, RodrigoResponseError } from '@/lib/rodrigo/service-client';
import { deriveActionQueueScope } from '@/lib/rodrigo/queue-scope';
import { deriveSiteSlug, siteSharePath } from '@/lib/site';
import type { SiteBlock, SitePage } from '@sorye/types';
import { NextResponse } from 'next/server';

function fromResource(resource: Record<string, unknown>, workspaceId: string): SitePage | null {
  if (typeof resource.slug !== 'string' || typeof resource.title !== 'string' || typeof resource.published !== 'boolean' || !Array.isArray(resource.blocks) || typeof resource.updatedAt !== 'string') return null;
  const blocks: SiteBlock[] = [];
  for (const value of resource.blocks) {
    if (!value || typeof value !== 'object') return null;
    const block = value as Record<string, unknown>;
    if (typeof block.id !== 'string' || typeof block.kind !== 'string' || !block.content || typeof block.content !== 'object' || Array.isArray(block.content)) return null;
    const type = block.kind === 'shop' ? 'storefront' : block.kind;
    blocks.push({ id: block.id, type, ...(block.content as object) } as SiteBlock);
  }
  return { workspaceId, slug: resource.slug, displayName: resource.title, published: resource.published, blocks, updatedAt: resource.updatedAt };
}

export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('site')) {
    return NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403 });
  }
  try {
    const snapshot = await getRodrigoResource({ userId: session.user.id, workspaceId: session.workspace.id }, 'site', 'page', session.workspace.id);
    const site = snapshot.resource ? fromResource(snapshot.resource, session.workspace.id) : null;
    if (snapshot.resource && !site) return NextResponse.json({ error: { code: 'invalid_rodrigo_resource' } }, { status: 502 });
    const page = site ?? { workspaceId: session.workspace.id, slug: deriveSiteSlug(session.workspace.name, session.workspace.id), published: false, displayName: session.workspace.name, blocks: [], updatedAt: new Date(0).toISOString() };
    const queueScope = deriveActionQueueScope('site', session.user.id, session.workspace.id);
    return NextResponse.json({ site: page, revision: snapshot.revision, queueScope, sharePath: siteSharePath(page.slug) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof RodrigoResponseError ? error.status : 503;
    const code = error instanceof RodrigoResponseError ? error.code : 'rodrigo_unavailable';
    return NextResponse.json({ error: { code } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

/** Legacy store writes are cut off. Site edits must be queued in IndexedDB and submitted to /api/backend/actions/batch. */
export async function PUT() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401 });
  return NextResponse.json({ error: { code: 'legacy_writer_disabled' } }, { status: 410 });
}
export { PUT as POST };
