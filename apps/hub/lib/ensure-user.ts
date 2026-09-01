import {
  getHubSession,
  getHubSessionForWorkspace,
  getOrCreateUser,
  getUserByEmail,
} from '@/lib/store';
import { auth } from '@/auth';
import {
  DEV_BYPASS_USER_ID,
  getDevBypassLookupEmails,
  getDevBypassProfile,
  isAuthDevBypass,
} from '@/lib/auth-dev-bypass';
import { getAdminEmails } from '@/lib/env';
import { EMBED_COOKIE, verifyEmbedToken } from '@/lib/embed-token';
import { cookies, headers } from 'next/headers';

async function sessionFromEmbedCookie() {
  const jar = await cookies();
  const token = jar.get(EMBED_COOKIE)?.value;
  if (!token) return null;
  const payload = verifyEmbedToken(token);
  if (!payload) return null;
  return getHubSessionForWorkspace(payload.uid, payload.ws);
}

export async function ensureHubUser() {
  const embedSession = await sessionFromEmbedCookie();
  const hdrs = await headers();
  const referer = hdrs.get('referer') ?? '';
  const fromEmbed = referer.includes('/embed/');

  // Inside an embed iframe, prefer the embed workspace even if the browser
  // also has a hub Google session cookie.
  if (embedSession && fromEmbed) {
    return embedSession;
  }

  const session = await auth();
  if (
    session?.user?.id &&
    session.user.email &&
    session.user.id !== DEV_BYPASS_USER_ID
  ) {
    const admins = getAdminEmails();
    const email = session.user.email.toLowerCase();

    await getOrCreateUser({
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.name ?? session.user.email,
      image: session.user.image ?? undefined,
      isAdmin: admins.has(email),
    });

    return getHubSession(session.user.id);
  }

  if (isAuthDevBypass()) {
    for (const email of getDevBypassLookupEmails()) {
      const existing = await getUserByEmail(email);
      if (existing) {
        return getHubSession(existing.id);
      }
    }

    const profile = getDevBypassProfile();
    await getOrCreateUser({
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      isAdmin: true,
    });
    return getHubSession(profile.id);
  }

  return embedSession;
}
