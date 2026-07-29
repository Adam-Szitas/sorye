import {
  EMBED_COOKIE,
  EMBED_TOKEN_TTL_SEC,
  verifyEmbedToken,
} from '@/lib/embed-token';
import { NextResponse } from 'next/server';

/**
 * Sets the embed session cookie then redirects into the chrome-less app host.
 * Used as the iframe `src` so cookies() can be written from a Route Handler.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t');
  const app = url.searchParams.get('app');

  if (!token || !app) {
    return NextResponse.json(
      { error: 't and app query params are required' },
      { status: 400 },
    );
  }

  const payload = verifyEmbedToken(token);
  if (!payload || payload.app !== app) {
    return NextResponse.json(
      { error: 'Invalid or expired embed token' },
      { status: 401 },
    );
  }

  const redirectTo = new URL(`/embed/${encodeURIComponent(app)}`, url.origin);
  redirectTo.searchParams.set('t', token);

  const res = NextResponse.redirect(redirectTo);
  const isProd = process.env.NODE_ENV === 'production';
  res.cookies.set(EMBED_COOKIE, token, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/',
    maxAge: EMBED_TOKEN_TTL_SEC,
  });

  // Restrict who may frame this response / the follow-up page.
  const ancestors = ['\'self\'', ...payload.origins].join(' ');
  res.headers.set('Content-Security-Policy', `frame-ancestors ${ancestors}`);

  return res;
}
