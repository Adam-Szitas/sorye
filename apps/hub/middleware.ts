import { auth } from '@/auth';
import { NextResponse } from 'next/server';

const publicPaths = [
  '/login',
  '/api/auth',
  '/embed',
  '/api/embed',
  '/embed.js',
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic = publicPaths.some((p) => pathname.startsWith(p));
  const isAdminApi = pathname.startsWith('/api/admin');

  if (isAdminApi) {
    return NextResponse.next();
  }

  if (!req.auth && !isPublic) {
    const login = new URL('/login', req.nextUrl.origin);
    login.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(login);
  }

  const res = NextResponse.next();

  // Framing is further restricted by origin checks in bootstrap + embed page.
  // Allowed origins are enforced before a token is issued.
  if (pathname.startsWith('/embed')) {
    // Bootstrap + referer checks enforce the origin allowlist; CSP allows framing.
    res.headers.set('Content-Security-Policy', 'frame-ancestors *');
  }

  return res;
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
