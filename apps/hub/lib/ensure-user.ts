import {
  getHubSession,
  getHubSessionForWorkspace,
  getOrCreateUser,
} from '@/lib/store';
import { auth } from '@/auth';
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
  const fromEmbed =
    referer.includes('/embed/') ||
    hdrs.get('sec-fetch-dest') === 'iframe';

  // Inside an embed iframe, prefer the embed workspace even if the browser
  // also has a hub Google session cookie.
  if (embedSession && fromEmbed) {
    return embedSession;
  }

  const session = await auth();
  if (session?.user?.id && session.user.email) {
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

  return embedSession;
}
