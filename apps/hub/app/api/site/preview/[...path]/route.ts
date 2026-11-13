import { publicRequestOrigin } from '@/lib/auth-origin';
import { draftSource, loadDrafts } from '@/lib/site-cms/drafts';
import { issueFormToken } from '@/lib/site-cms/form-guard';
import { rodrigoContext, siteSession } from '@/lib/site-cms/owner';
import { renderRoute, resolveRoute } from '@/lib/site-cms/render';

/**
 * Draft preview for members: the same renderer as the public site, over the drafts,
 * marked "not public", never indexed or cached. Forms render but do not submit.
 * `/api/site/preview/{locale}/[page | collection/item]`.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const gate = await siteSession();
  if ('response' in gate) return gate.response;
  const context = rodrigoContext(gate.session);
  try {
    const drafts = await loadDrafts(context, { submissions: false });
    const source = await draftSource(context, drafts);
    if (!source) return new Response('Save the site settings first.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    let origin: string;
    try { origin = publicRequestOrigin(req.headers); } catch { origin = new URL(req.url).origin; }
    const rendered = await renderRoute({
      source, route: resolveRoute(source, path.slice(0, 3)), origin, preview: true,
      formToken: issueFormToken(source.slug), formAction: () => '#',
    });
    // Links inside the preview stay inside the preview.
    const html = rendered.html.replaceAll(`href="/s/${source.slug}/`, 'href="/api/site/preview/');
    return new Response(html, {
      status: rendered.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex',
        'Content-Security-Policy': rendered.csp.replace("form-action 'self'", "form-action 'none'").replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('The preview cannot be loaded right now.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
