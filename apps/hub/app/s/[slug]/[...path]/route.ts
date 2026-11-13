import { randomUUID } from 'node:crypto';
import { isSiteLocale, isSectionId, type SiteFormField } from '@sorye/site-sdk';
import { publicRequestOrigin } from '@/lib/auth-origin';
import { answersFromForm, checkFormToken, issueFormToken, rateLimit, SITE_FORM_LIMITS } from '@/lib/site-cms/form-guard';
import { openSiteMedia, submitSiteForm } from '@/lib/site-cms/public-client';
import { withPublishedSource } from '@/lib/site-cms/published';
import { pagePath, renderRoute, renderSitemap, resolveRoute } from '@/lib/site-cms/render';

/**
 * Public Site renderer for CMS sites: `/s/{slug}/{locale}/[page | collection/item]`,
 * `/s/{slug}/sitemap.xml`, `/s/{slug}/media/{id}` and the contact-form POST
 * `/s/{slug}/_form/{pageId}/{sectionId}`. Pages are complete static HTML with no
 * scripts; the CSP allows only the hashed inline styles and same-origin images.
 * The bare `/s/{slug}` is handled by `../page.tsx` (locale redirect or legacy page).
 */
export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
interface Params { params: Promise<{ slug: string; path: string[] }> }

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

function unavailable(): Response {
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Unavailable</title></head><body><p>This page cannot be loaded right now.</p></body></html>', {
    status: 503, headers: { ...HTML_HEADERS, 'Cache-Control': 'no-store', 'Retry-After': '30', 'Content-Security-Policy': "default-src 'none'" },
  });
}

function notFound(): Response {
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><p>Page not found.</p></body></html>', {
    status: 404, headers: { ...HTML_HEADERS, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" },
  });
}

function origin(req: Request): string {
  try { return publicRequestOrigin(req.headers); } catch { return new URL(req.url).origin; }
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
  const { slug, path } = await params;
  if (!SLUG.test(slug) || slug.length > 64 || path.length > 4) return notFound();
  if (path[0] === 'media' && path.length === 2) return media(req, slug, path[1]!);
  const url = new URL(req.url);
  try {
    const response = await withPublishedSource(slug, async (source) => {
      if (path.length === 1 && path[0] === 'sitemap.xml') {
        return new Response(await renderSitemap(source, origin(req)), {
          headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' },
        });
      }
      const route = resolveRoute(source, path);
      const sent = url.searchParams.get('sent');
      const failed = url.searchParams.get('form_error');
      const formState = sent && isSectionId(sent) ? { sectionId: sent, kind: 'sent' as const }
        : failed && isSectionId(failed) ? { sectionId: failed, kind: 'error' as const, code: url.searchParams.get('code') === 'rate_limited' ? 'rate_limited' : 'failed' } : undefined;
      const rendered = await renderRoute({
        source, route, origin: origin(req), preview: false, formToken: issueFormToken(slug),
        formAction: (pageId, sectionId) => `/s/${slug}/_form/${pageId}/${sectionId}`,
        ...(formState ? { formState } : {}),
      });
      return new Response(rendered.html, {
        status: rendered.status,
        headers: {
          ...HTML_HEADERS, 'Content-Security-Policy': rendered.csp,
          // Pages carry a per-render form token, so shared caches may keep them only briefly.
          'Cache-Control': rendered.status === 200 && !formState ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=60' : 'no-store',
        },
      });
    });
    return response ?? notFound();
  } catch (error) {
    // No visitor data in the log: only the error kind and message.
    console.error('[site] public render failed', error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error');
    return unavailable();
  }
}

async function media(req: Request, slug: string, mediaId: string): Promise<Response> {
  try {
    const upstream = await openSiteMedia(slug, mediaId, { range: req.headers.get('range'), ifNoneMatch: req.headers.get('if-none-match') });
    if (!upstream) return notFound();
    const headers = new Headers({
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'X-Content-Type-Options': 'nosniff',
      // Media is never rendered as a document of this origin.
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (headers.get('content-type') === 'application/pdf') headers.set('Content-Disposition', 'inline');
    return new Response(upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } });
  }
}

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const { slug, path } = await params;
  const [kind, pageId, sectionId] = path;
  if (!SLUG.test(slug) || kind !== '_form' || path.length !== 3 || !isSectionId(pageId) || !isSectionId(sectionId)) return notFound();
  const site = origin(req);
  const length = Number(req.headers.get('content-length'));
  const type = req.headers.get('content-type') ?? '';
  const back = (locale: string, params: Record<string, string>, pathname?: string) => {
    const target = new URL(pathname ?? `/s/${slug}/${locale}`, site);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    target.hash = sectionId!;
    return new Response(null, { status: 303, headers: { Location: target.toString(), 'Cache-Control': 'no-store' } });
  };
  const wait = rateLimit(req.headers, slug);
  if (!type.startsWith('application/x-www-form-urlencoded') || (Number.isFinite(length) && length > SITE_FORM_LIMITS.maxBodyBytes)) return notFound();
  let form: FormData;
  try {
    const text = await boundedText(req, SITE_FORM_LIMITS.maxBodyBytes);
    form = new FormData();
    for (const [k, v] of new URLSearchParams(text)) form.append(k, v);
  } catch { return notFound(); }
  const localeValue = String(form.get('_l') ?? '');
  try {
    const result = await withPublishedSource(slug, async (source) => {
      const locale = isSiteLocale(localeValue) && source.settings.locales.includes(localeValue) ? localeValue : source.settings.defaultLocale;
      const returnPath = pagePath(source, locale, pageId!);
      if (wait > 0) return back(locale, { form_error: sectionId!, code: 'rate_limited' }, returnPath);
      // Bots that fill the hidden field or post instantly get the same answer as people.
      const honeypot = String(form.get('website') ?? '') !== '';
      const tokenProblem = checkFormToken(slug, String(form.get('_t') ?? ''));
      if (honeypot || tokenProblem === 'too_fast') return back(locale, { sent: sectionId! }, returnPath);
      if (tokenProblem) return back(locale, { form_error: sectionId! }, returnPath);
      const page = await source.loadPage(pageId!);
      const section = page?.sections.find((s) => s.id === sectionId && s.type === 'contactForm');
      if (!section) return notFound();
      const answers = answersFromForm(form, section.props.fields as SiteFormField[]);
      const outcome = await submitSiteForm(slug, pageId!, sectionId!, { submissionId: randomUUID(), locale, answers });
      if (outcome === 'not_found') return notFound();
      return outcome === 'accepted' || outcome === 'duplicate' ? back(locale, { sent: sectionId! }, returnPath) : back(locale, { form_error: sectionId! }, returnPath);
    });
    return result ?? notFound();
  } catch {
    return unavailable();
  }
}

async function boundedText(req: Request, limit: number): Promise<string> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('too_large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks).toString('utf8');
}
