import { preferredLocale } from '@/lib/preferred-locale';
import { unavailablePageHtml } from '@/lib/unavailable-page';
import { landingSlugForHost } from '@/lib/app-landings';
import { auth } from '@/auth';
import { isAuthDevBypass } from '@/lib/auth-dev-bypass';
import { InvalidAuthOrigin, withPublicAuthOrigin } from '@/lib/auth-origin';
import {
  adminOrigin,
  classifyHost,
  effectiveHost,
  hostConfig,
  hostnameOf,
  isAdminOnlyApi,
  isAdminSurfacePath,
  mutationOriginDenied,
} from '@/lib/admin/hosts';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

const publicPaths = [
  '/sitemap.xml',
  '/learn',
  '/login',
  '/api/auth',
  '/embed',
  '/api/embed',
  '/embed.js',
  '/contact',
  // Plan comparison for visitors; choosing a plan goes to the signed-in /billing page.
  '/pricing',
  '/apps/contact',
  '/architecture',
  '/s',
  // Published forms.
  '/f',
  // Anonymous Forms read and submit. Bounded and rate-limited in the route handlers.
  '/api/forms/public',
];

/** Dev-only: Vite remotes on another localhost port call Hub `/api` with cookies. */
const DEV_LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

function devStandaloneOrigin(req: {
  headers: Headers;
  nextUrl: URL;
}): string | null {
  if (process.env.NODE_ENV !== 'development') return null;
  if (!req.nextUrl.pathname.startsWith('/api/')) return null;
  const origin = req.headers.get('origin');
  if (!origin || origin === req.nextUrl.origin) return null;
  if (!DEV_LOCAL_ORIGIN.test(origin)) return null;
  return origin;
}

function withDevCors(res: NextResponse, origin: string): NextResponse {
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Credentials', 'true');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  res.headers.set('Vary', 'Origin');
  return res;
}

function plain(status: number, body: string): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** `'self'` plus the origins named in an embed token, or `'none'` without a usable token. */
function embedFrameAncestors(token: string | null): string {
  const body = token?.split('.')[0];
  if (!body || body.length > 8192) return "'none'";
  try {
    const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
    const origins = (JSON.parse(json) as { origins?: unknown }).origins;
    if (!Array.isArray(origins)) return "'none'";
    const safe = origins.filter((o): o is string => typeof o === 'string' && /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(o)).slice(0, 32);
    return ["'self'", ...safe].join(' ');
  } catch {
    return "'none'";
  }
}

function jsonError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function withAdminHeaders(res: NextResponse): NextResponse {
  res.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'same-origin');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  return res;
}

const hubMiddleware = auth((req) => {
  const { pathname, search } = req.nextUrl;
  const config = hostConfig();
  const { host, forwarded } = effectiveHost(req.headers);
  const hostKind = classifyHost(host, { forwarded }, config);
  if (hostKind === 'unknown') return plain(421, 'Misdirected request');

  const standaloneOrigin = devStandaloneOrigin(req);
  const originDenied = mutationOriginDenied({
    method: req.method,
    pathname,
    origin: req.headers.get('origin'),
    secFetchSite: req.headers.get('sec-fetch-site'),
    requestHost: host,
    devAllowedOrigin: Boolean(standaloneOrigin) && hostKind !== 'admin',
    requireBrowserOrigin: hostKind === 'admin',
  });
  // Read the flag here so Next.js inlines AUTH_DEV_BYPASS into the Edge bundle.
  const localBypass =
    process.env.NODE_ENV === 'development' &&
    process.env.AUTH_DEV_BYPASS === 'true' &&
    isAuthDevBypass();

  if (hostKind === 'admin') {
    // Middleware redirects need an absolute URL; Next.js relativizes it when the origin matches.
    const adminRedirect = (location: string) => {
      const response = NextResponse.redirect(`${adminOrigin(host, req.nextUrl.protocol, config)}${location}`, 307);
      response.headers.set('Cache-Control', 'no-store');
      return withAdminHeaders(response);
    };
    if (pathname === '/') return adminRedirect('/admin');
    if (!isAdminSurfacePath(pathname, config.production)) return withAdminHeaders(plain(404, 'Not found'));
    if (originDenied) return withAdminHeaders(jsonError(403, originDenied));
    const isPage = pathname === '/admin' || pathname.startsWith('/admin/');
    if (isPage && !req.auth && !localBypass) {
      const callbackUrl = encodeURIComponent(`${pathname}${search}`);
      return adminRedirect(`/login?callbackUrl=${callbackUrl}`);
    }
    return withAdminHeaders(NextResponse.next());
  }

  if (pathname === '/apps/operator') {
    const response = NextResponse.redirect(`${adminOrigin(host, req.nextUrl.protocol, config)}/admin`, 307);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const destination = `${adminOrigin(host, req.nextUrl.protocol, config)}${pathname}${search}`;
    const response = NextResponse.redirect(destination, 307);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  if (isAdminOnlyApi(pathname)) return jsonError(404, 'admin_host_required');
  if (originDenied) return jsonError(403, originDenied);

  const landingSlug = landingSlugForHost(hostnameOf(host), config.publicHost);
  const unlocalized = /^\/learn\/([^/]+)\/?$/.exec(pathname);
  if ((pathname === '/' && landingSlug) || unlocalized) {
    const destination = req.nextUrl.clone();
    destination.pathname = '/learn/' + (pathname === '/' ? landingSlug : unlocalized![1]) + '/' + preferredLocale(req.headers.get('accept-language'));
    const response = NextResponse.redirect(destination, 307);
    response.headers.set('Vary', 'Accept-Language');
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
  if (standaloneOrigin && req.method === 'OPTIONS') {
    return withDevCors(new NextResponse(null, { status: 204 }), standaloneOrigin);
  }

  const isPublic = publicPaths.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAdminApi = pathname.startsWith('/api/admin');

  if (isAdminApi) {
    return standaloneOrigin ? withDevCors(NextResponse.next(), standaloneOrigin) : NextResponse.next();
  }

  if (!req.auth && !isPublic && !localBypass) {
    const login = new URL('/login', req.nextUrl.origin);
    login.searchParams.set('callbackUrl', pathname);
    const redirect = NextResponse.redirect(login);
    return standaloneOrigin ? withDevCors(redirect, standaloneOrigin) : redirect;
  }

  const res = NextResponse.next();

  // Only the widget's allowlisted origins may frame an embed page. The origins
  // come from the token in the URL; the page itself verifies the signature, so a
  // forged token only ever reaches the error screen.
  if (pathname.startsWith('/embed/')) {
    res.headers.set('Content-Security-Policy', `frame-ancestors ${embedFrameAncestors(req.nextUrl.searchParams.get('t'))}`);
  }

  return standaloneOrigin ? withDevCors(res, standaloneOrigin) : res;
});

/**
 * Safety net around the middleware: an unexpected failure (configuration,
 * Auth.js, a dependency) answers with a clear 503 instead of Next.js' bare
 * "Internal Server Error", and the cause is logged by name for `docker logs`.
 */
export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  try {
    const publicRequest = withPublicAuthOrigin(req);
    const response = await (hubMiddleware as unknown as (r: NextRequest, e: NextFetchEvent) => Promise<Response | undefined>)(publicRequest, event);
    if (response?.headers.get('x-middleware-next') === '1') {
      // Server actions/auth() derive URLs from headers rather than request.url.
      const overrides = NextResponse.next({ request: { headers: publicRequest.headers } });
      overrides.headers.forEach((value, name) => {
        if (name.startsWith('x-middleware-request-') || name === 'x-middleware-override-headers') response.headers.set(name, value);
      });
    }
    return response;
  } catch (error) {
    if (error instanceof InvalidAuthOrigin) return plain(421, 'Invalid public origin configuration');
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message.split('\n')[0]!.slice(0, 300) : String(error).slice(0, 300);
    console.error(`[sorye] request failed before reaching the page: ${req.method} ${req.nextUrl.pathname} — ${name}: ${message}`);
    return hubUnavailable(req);
  }
}

function hubUnavailable(req: NextRequest): Response {
  const headers = { 'Cache-Control': 'no-store', 'Retry-After': '30', 'X-Content-Type-Options': 'nosniff' };
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: { code: 'hub_unavailable' } }, { status: 503, headers });
  }
  const html = unavailablePageHtml(req.headers.get('accept-language'), req.nextUrl.pathname);
  return new Response(html, { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
