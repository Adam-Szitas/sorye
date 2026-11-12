import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { withPublicAuthOrigin } from './lib/auth-origin';
import { NextRequest } from 'next/server';

const nextAuth = NextAuth(authConfig);
export const { auth, signIn, signOut } = nextAuth;

async function handle(request: NextRequest) {
  let publicRequest: NextRequest;
  try {
    publicRequest = withPublicAuthOrigin(request);
  } catch {
    return new Response('Invalid authentication origin', { status: 421 });
  }
  return nextAuth.handlers[request.method === 'POST' ? 'POST' : 'GET'](publicRequest);
}

export const handlers = { GET: handle, POST: handle };
