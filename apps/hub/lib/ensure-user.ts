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
import type { ServerTimings } from './server-timing';

async function sessionFromEmbedCookie() {
  const jar = await cookies();
  const token = jar.get(EMBED_COOKIE)?.value;
  if (!token) return null;
  const payload = verifyEmbedToken(token);
  if (!payload) return null;
  return getHubSessionForWorkspace(payload.uid, payload.ws);
}

export async function ensureHubUser(timings?: ServerTimings) {
  const measure = <T>(name: string, task: () => Promise<T>) => timings ? timings.measure(name, task) : task();
  const embedSession = await measure('embed', sessionFromEmbedCookie);
  const hdrs = await headers();
  const referer = hdrs.get('referer') ?? '';
  const fromEmbed = referer.includes('/embed/');

  // Inside an embed iframe, prefer the embed workspace even if the browser
  // also has a hub Google session cookie.
  if (embedSession && fromEmbed) {
    return embedSession;
  }

  const session = await measure('auth', () => auth());
  if (
    session?.user?.id &&
    session.user.email &&
    session.user.id !== DEV_BYPASS_USER_ID
  ) {
    const admins = getAdminEmails();
    const { id, email, name, image } = session.user;

    await measure('profile', () => getOrCreateUser({
      id,
      email,
      displayName: name ?? email,
      image: image ?? undefined,
      isAdmin: admins.has(email.toLowerCase()),
    }));

    return measure('hub_session', () => getHubSession(id));
  }

  if (isAuthDevBypass()) {
    for (const email of getDevBypassLookupEmails()) {
      const existing = await measure('dev_identity', () => getUserByEmail(email));
      if (existing) {
        return measure('hub_session', () => getHubSession(existing.id));
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
