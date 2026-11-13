import { isSectionId } from '@sorye/site-sdk';
import { getRodrigoResource } from '@/lib/rodrigo/service-client';
import { openObject } from '@/lib/rodrigo/objects-client';
import { rodrigoContext, rodrigoFailure, siteSession } from '@/lib/site-cms/owner';

/** A library file for members of the workspace (CMS thumbnails and draft preview). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await siteSession();
  if ('response' in gate) return gate.response;
  if (!isSectionId(id)) return new Response(null, { status: 404 });
  const context = rodrigoContext(gate.session);
  try {
    const entry = await getRodrigoResource(context, 'site', 'media', id);
    const objectId = typeof entry.resource?.objectId === 'string' ? entry.resource.objectId : null;
    if (!objectId) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const upstream = await openObject(context, 'site', objectId, req.headers.get('range') ?? undefined);
    const headers = new Headers({ 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return rodrigoFailure(error);
  }
}
