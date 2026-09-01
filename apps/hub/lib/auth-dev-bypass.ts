/**
 * Local-only Hub session bypass. Must stay false unless BOTH:
 * - NODE_ENV === 'development' (next dev)
 * - AUTH_DEV_BYPASS === 'true'
 *
 * Production (Fly.io NODE_ENV=production) never honors this, and getEnv()
 * refuses to boot if the flag is set there.
 */

/** Stable id for a newly created local user — not a Google subject. */
export const DEV_BYPASS_USER_ID = 'dev-local';

export const DEV_BYPASS_EMAIL = 'dev@localhost';

export function isAuthDevBypass(): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.AUTH_DEV_BYPASS === 'true'
  );
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/** Prefer an existing Google/admin user, then a prior local bypass row. */
export function getDevBypassLookupEmails(): string[] {
  const emails = adminEmails();
  if (!emails.includes(DEV_BYPASS_EMAIL)) {
    emails.push(DEV_BYPASS_EMAIL);
  }
  return emails;
}

export function getDevBypassProfile(): {
  id: string;
  email: string;
  displayName: string;
} {
  return {
    id: DEV_BYPASS_USER_ID,
    email: DEV_BYPASS_EMAIL,
    displayName: 'Local Dev',
  };
}
