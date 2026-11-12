import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { generateKeyPairSync, sign } from 'node:crypto';
import { NextRequest, type NextFetchEvent } from 'next/server';
import NextAuth, { customFetch } from 'next-auth';
import Google from 'next-auth/providers/google';
import { publicRequestOrigin, withPublicAuthOrigin } from '../lib/auth-origin';

const prod = { NODE_ENV: 'production', AUTH_TRUST_HOST: 'true' } as NodeJS.ProcessEnv;
const proxyHeaders = (host = 'sorye.app') => new Headers({
  host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https',
});

test('public origin validates proxy configuration, host and scheme', () => {
  for (const host of ['sorye.app', 'admin.sorye.app', 'tasks.sorye.app']) {
    assert.equal(publicRequestOrigin(proxyHeaders(host), prod), `https://${host}`);
  }
  for (const host of ['evil.example', 'sorye.app.evil.example', '0.0.0.0:3000', 'sorye.app,evil.example', 'sorye.app:3000', 'user@sorye.app', 'sorye.app/path']) {
    assert.throws(() => publicRequestOrigin(proxyHeaders(host), prod));
  }
  for (const protocol of ['http', 'https,http', 'javascript']) {
    const headers = proxyHeaders();
    headers.set('x-forwarded-proto', protocol);
    assert.throws(() => publicRequestOrigin(headers, prod));
  }
  for (const trust of [undefined, 'false']) {
    assert.throws(() => publicRequestOrigin(proxyHeaders(), { ...prod, AUTH_TRUST_HOST: trust }));
  }
  for (const setting of ['AUTH_URL', 'NEXTAUTH_URL']) {
    assert.throws(() => publicRequestOrigin(proxyHeaders(), { ...prod, [setting]: 'https://0.0.0.0:3000' }));
  }
  assert.equal(publicRequestOrigin(new Headers({ host: '127.0.0.1:3000' }), prod), 'https://127.0.0.1:3000');
});

test('development uses its host/port and ignores untrusted forwarded headers', () => {
  for (const host of ['localhost:3000', '127.0.0.1:23000', 'admin.localhost:3000']) {
    const headers = new Headers({ host, 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' });
    assert.equal(publicRequestOrigin(headers, { NODE_ENV: 'development' }), `http://${host}`);
  }
});

test('normalization preserves POST contents, cookies and query while removing the bind port', async () => {
  const origin = publicRequestOrigin(new Headers({ host: 'localhost:23000' }));
  const request = new NextRequest('http://0.0.0.0:3000/api/auth/signin/google?test=1', {
    method: 'POST', headers: { host: 'localhost:23000', cookie: 'test-only=value', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'callbackUrl=%2Fadmin',
  });
  const normalized = withPublicAuthOrigin(request);
  assert.equal(normalized.url, `${origin}/api/auth/signin/google?test=1`);
  assert.equal(normalized.headers.get('cookie'), 'test-only=value');
  assert.equal(normalized.headers.get('x-forwarded-host'), 'localhost:23000');
  assert.equal(await normalized.text(), 'callbackUrl=%2Fadmin');
});

// Exercise the installed Auth.js transport with a new PKCE cookie and synthetic
// code on every run. No Google network calls, production cookies or codes.
test('installed Auth.js uses one public callback for authorization, exchange and redirects', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, prod);
  process.env.AUTH_SECRET = 'test-only-secret-with-at-least-32-characters';
  delete process.env.AUTH_URL;
  delete process.env.NEXTAUTH_URL;
  const requireAuth = createRequire(import.meta.url);
  const requireNextAuth = createRequire(requireAuth.resolve('next-auth'));
  const { Auth, skipCSRFCheck, createActionURL } = await import(pathToFileURL(requireNextAuth.resolve('@auth/core')).href);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = () => {
    const enc = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const input = `${enc({ alg: 'RS256' })}.${enc({ iss: 'https://accounts.google.com', aud: 'test-client', sub: 'test-user', email: 'test@example.test', iat: now, exp: now + 300 })}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
  };
  try {
    const { default: middleware } = await import('../middleware');
    const event = {} as NextFetchEvent;
    const protectedResponse = await middleware(new NextRequest('https://0.0.0.0:3000/apps/tasks', { headers: proxyHeaders() }), event);
    assert.equal(protectedResponse?.headers.get('location'), 'https://sorye.app/login?callbackUrl=%2Fapps%2Ftasks');
    const health = await middleware(new NextRequest('http://127.0.0.1:3000/login', { headers: { host: '127.0.0.1:3000' } }), event);
    assert.equal(health?.status, 200, 'container login healthcheck remains reachable');
    const publicLogin = await middleware(new NextRequest('https://0.0.0.0:3000/login', { headers: proxyHeaders() }), event);
    assert.equal(publicLogin?.headers.get('x-middleware-request-x-forwarded-host'), 'sorye.app');
    assert.equal(publicLogin?.headers.get('x-middleware-request-x-forwarded-proto'), 'https');
    const invalid = await middleware(new NextRequest('https://0.0.0.0:3000/api/auth/callback/google', { headers: proxyHeaders('evil.example') }), event);
    assert.equal(invalid?.status, 421);
    assert.equal(invalid?.headers.get('location'), null, 'invalid origin is never reflected into a redirect');
    for (const host of ['sorye.app', 'admin.sorye.app', 'tasks.sorye.app', 'localhost:3000', 'admin.localhost:3000']) {
      const local = host.includes('localhost');
      Object.assign(process.env, { NODE_ENV: local ? 'development' : 'production' });
      const origin = `${local ? 'http' : 'https'}://${host}`;
      const headers = proxyHeaders(host);
      headers.set('x-forwarded-proto', local ? 'http' : 'https');
      if (host === 'localhost:3000') {
        delete process.env.AUTH_TRUST_HOST;
        const untrusted = new Headers(headers);
        untrusted.set('x-forwarded-host', 'evil.example');
        const localPage = await middleware(new NextRequest('http://0.0.0.0:3000/login', { headers: untrusted }), event);
        assert.equal(localPage?.headers.get('x-middleware-request-x-forwarded-host'), host);
        assert.equal(localPage?.headers.get('x-middleware-request-x-forwarded-proto'), 'http');
        process.env.AUTH_TRUST_HOST = 'true';
      }
      let exchangeRedirect: string | null = null;
      let fail = false;
      const errors: unknown[] = [];
      const config = {
        secret: 'test-only-secret-with-at-least-32-characters', trustHost: true,
        basePath: '/api/auth', pages: { signIn: '/login', error: '/login' },
        logger: { error: (error: unknown) => { errors.push(error); } },
        providers: [Google({
          clientId: 'test-client', clientSecret: 'test-only-client-secret',
          [customFetch]: async (input, init) => {
            const url = String(input);
            if (url.includes('.well-known')) return Response.json({
              issuer: 'https://accounts.google.com', authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
              token_endpoint: 'https://oauth2.googleapis.com/token', userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
              jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs', response_types_supported: ['code'],
              subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
            });
            assert.equal(url, 'https://oauth2.googleapis.com/token', 'only discovery and token requests expected');
            const body = init?.body as URLSearchParams;
            exchangeRedirect = body.get('redirect_uri');
            assert.ok(body.get('code_verifier'), 'fresh PKCE verifier reaches exchange');
            if (fail) return Response.json({ error: 'invalid_grant' }, { status: 400 });
            return Response.json({ access_token: 'test-only-token', token_type: 'Bearer', id_token: jwt() });
          },
        })],
      };
      const { handlers } = NextAuth(config);
      for (const failure of [false, true]) {
        fail = failure;
        exchangeRedirect = null;
        const actionUrl = createActionURL('signin', local ? 'http' : 'https', headers, {}, config);
        const start = await Auth(new Request(`${actionUrl}/google`, {
          method: 'POST', headers: { ...Object.fromEntries(headers), 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ callbackUrl: `${origin}/admin` }),
        }), { ...config, skipCSRFCheck });
        const authorization = new URL(start.headers.get('location')!);
        assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}/api/auth/callback/google`);
        const cookies = start.headers.getSetCookie().map((cookie: string) => cookie.split(';')[0]).join('; ');
        assert.match(cookies, /pkce.code_verifier=/);
        const callbackHeaders = new Headers(headers);
        callbackHeaders.set('cookie', cookies);
        const callback = new NextRequest('https://0.0.0.0:3000/api/auth/callback/google?code=fresh-test-code', { headers: callbackHeaders });
        if (host === 'sorye.app' && failure) {
          const broken = await handlers.GET(new NextRequest(callback.url, { headers: callbackHeaders }));
          assert.equal(exchangeRedirect, 'https://0.0.0.0:3000/api/auth/callback/google');
          assert.equal(broken.headers.get('location'), 'https://0.0.0.0:3000/login?error=Configuration');
          errors.pop();
        }
        const response = await handlers.GET(withPublicAuthOrigin(callback));
        assert.equal(exchangeRedirect, `${origin}/api/auth/callback/google`);
        assert.equal(response.headers.get('location'), `${origin}/${failure ? 'login?error=Configuration' : 'admin'}`);
        if (!failure) {
          assert.equal(errors.length, 0);
          assert.ok(response.headers.getSetCookie().some((cookie) => cookie.includes('session-token=')));
        } else {
          assert.equal(errors.length, 1, 'original callback error remains available server-side');
        }
      }
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
