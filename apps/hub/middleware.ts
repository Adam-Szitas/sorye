import { auth } from '@/auth';
import { isAuthDevBypass } from '@/lib/auth-dev-bypass';
import { NextResponse } from 'next/server';

const publicPaths = [
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

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const standaloneOrigin = devStandaloneOrigin(req);
  if (standaloneOrigin && req.method === 'OPTIONS') {
    return withDevCors(new NextResponse(null, { status: 204 }), standaloneOrigin);
  }

  const isPublic = publicPaths.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAdminApi = pathname.startsWith('/api/admin');
  // Read the flag here so Next.js inlines AUTH_DEV_BYPASS into the Edge bundle.
  const localBypass =
    process.env.NODE_ENV === 'development' &&
    process.env.AUTH_DEV_BYPASS === 'true' &&
    isAuthDevBypass();

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
