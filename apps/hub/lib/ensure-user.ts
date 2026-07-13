import {
  getHubSession,
  getOrCreateUser,
} from '@/lib/store';
import { auth } from '@/auth';
import { getAdminEmails } from '@/lib/env';

export async function ensureHubUser() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return null;
  }

  const existing = await getHubSession(session.user.id);
  if (existing) return existing;

  const admins = getAdminEmails();
  await getOrCreateUser({
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.name ?? session.user.email,
    image: session.user.image ?? undefined,
    isAdmin: admins.has(session.user.email.toLowerCase()),
  });

  return getHubSession(session.user.id);
}
