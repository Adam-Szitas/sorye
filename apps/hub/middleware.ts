import { preferredLocale } from '@/lib/preferred-locale';
import { landingSlugForHost } from '@/lib/app-landings';
import { auth } from '@/auth';
import { isAuthDevBypass } from '@/lib/auth-dev-bypass';
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
import { NextResponse } from 'next/server';

const publicPaths = [
  '/sitemap.xml',
  '/learn',
  '/login',
  '/api/auth',
  '/embed',
  '/api/embed',
  '/embed.js',
  '/contact',
  '/apps/contact',
  '/architecture',
  '/s',
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

function jsonError(status: number, code: string): NextResponse {
  return NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Same-origin redirect with a relative Location, so the proxied scheme and host are kept. */
function relativeRedirect(location: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}

function withAdminHeaders(res: NextResponse): NextResponse {
  res.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'same-origin');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  return res;
}

export default auth((req) => {
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
  });
  // Read the flag here so Next.js inlines AUTH_DEV_BYPASS into the Edge bundle.
  const localBypass =
    process.env.NODE_ENV === 'development' &&
    process.env.AUTH_DEV_BYPASS === 'true' &&
    isAuthDevBypass();

  if (hostKind === 'admin') {
    if (pathname === '/') return withAdminHeaders(relativeRedirect('/admin'));
    if (!isAdminSurfacePath(pathname, config.production)) return withAdminHeaders(plain(404, 'Not found'));
    if (originDenied) return withAdminHeaders(jsonError(403, originDenied));
    const isPage = pathname === '/admin' || pathname.startsWith('/admin/');
    if (isPage && !req.auth && !localBypass) {
      const callbackUrl = encodeURIComponent(`${pathname}${search}`);
      return withAdminHeaders(relativeRedirect(`/login?callbackUrl=${callbackUrl}`));
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

  // Framing is further restricted by origin checks in bootstrap + embed page.
  // Allowed origins are enforced before a token is issued.
  if (pathname.startsWith('/embed')) {
    // Bootstrap + referer checks enforce the origin allowlist; CSP allows framing.
    res.headers.set('Content-Security-Policy', 'frame-ancestors *');
  }

  return standaloneOrigin ? withDevCors(res, standaloneOrigin) : res;
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
