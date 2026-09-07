import { getAdminEmails } from '@/lib/env';
import { emailInAdminList } from '@/lib/security';

/**
 * Strictest existing admin gate: platform operators on `ADMIN_EMAILS`.
 *
 * Workspace `role: 'owner'` is assigned to every personal-workspace creator,
 * so it is not an admin check. `HubUser.isAdmin` is set from `ADMIN_EMAILS`
 * at login (and from local `AUTH_DEV_BYPASS` when that list is empty).
 *
 * When `ADMIN_EMAILS` is non-empty, email must match (timing-safe). When it
 * is empty, honor `user.isAdmin` so local bypass still works.
 */
export function isPlatformAdmin(user: {
  email: string;
  isAdmin: boolean;
}): boolean {
  const admins = getAdminEmails();
  if (admins.size > 0) {
    return emailInAdminList(user.email, admins);
  }
  return user.isAdmin === true;
}
