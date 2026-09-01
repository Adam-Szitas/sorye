import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import {
  getDevBypassProfile,
  isAuthDevBypass,
} from '@/lib/auth-dev-bypass';

const googleId = process.env.AUTH_GOOGLE_ID;
const googleSecret = process.env.AUTH_GOOGLE_SECRET;

const providers: NextAuthConfig['providers'] = [];

if (isAuthDevBypass()) {
  providers.push(
    Credentials({
      id: 'dev',
      name: 'Local development',
      credentials: {},
      authorize() {
        if (!isAuthDevBypass()) return null;
        const profile = getDevBypassProfile();
        return {
          id: profile.id,
          name: profile.displayName,
          email: profile.email,
        };
      },
    }),
  );
}

if (googleId && googleSecret) {
  providers.push(
    Google({
      clientId: googleId,
      clientSecret: googleSecret,
    }),
  );
}

export const authConfig = {
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  providers,
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async signIn() {
      return true;
    },
    jwt({ token, user, account }) {
      if (user?.id) {
        token.sub = user.id;
      }
      if (account?.provider === 'google' && account.providerAccountId) {
        token.sub = account.providerAccountId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? '';
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
