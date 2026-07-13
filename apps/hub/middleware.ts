import { auth } from '@/auth';
import { NextResponse } from 'next/server';

const publicPaths = ['/login', '/api/auth'];

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

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
