import { auth, signIn } from '@/auth';
import { isAuthDevBypass } from '@/lib/auth-dev-bypass';
import { ensureHubUser } from '@/lib/ensure-user';
import { safeRedirectPath } from '@/lib/security';
import { redirect } from 'next/navigation';

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  Configuration:
    'Sign-in is not configured. Check AUTH_SECRET and Google OAuth credentials in apps/hub/.env.local.',
  AccessDenied:
    'Google denied access. If the OAuth consent screen is in Testing mode, add your Google account as a test user.',
  OAuthSignin: 'Could not start Google sign-in.',
  OAuthCallback:
    'Google sign-in did not complete. Open http://localhost:3000 in a regular Chrome, Edge, or Firefox window (not Cursor Simple Browser, and not 127.0.0.1).',
  OAuthCreateAccount: 'Could not create your account.',
  Callback: 'Could not complete sign-in.',
  OAuthAccountNotLinked:
    'This email is already used with a different sign-in method.',
  SessionRequired: 'Please sign in to continue.',
  Default: 'Sign-in failed. Try again.',
};

function authErrorMessage(error: string | undefined): string | null {
  if (!error) return null;
  return AUTH_ERROR_MESSAGES[error] ?? AUTH_ERROR_MESSAGES.Default;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = safeRedirectPath(params.callbackUrl, '/');
  const oauthError = authErrorMessage(params.error);
  const localBypass = isAuthDevBypass();

  const authSession = await auth();
  let workspaceError: string | null = null;
  if (authSession?.user?.id || localBypass) {
    let hub = null;
    try {
      hub = await ensureHubUser();
    } catch {
      workspaceError = localBypass
        ? 'Local workspace could not be created. If STORE_DRIVER=postgres, make sure Postgres is running.'
        : 'Google sign-in succeeded, but your workspace could not be created. If STORE_DRIVER=postgres, make sure Postgres is running.';
    }
    if (hub) {
      redirect(redirectTo);
    } else if (!workspaceError) {
      workspaceError = localBypass
        ? 'Local workspace could not be loaded.'
        : 'Google sign-in succeeded, but your workspace could not be loaded.';
    }
  }

  const banner = workspaceError ?? (localBypass ? null : oauthError);
  const googleConfigured = Boolean(
    process.env.AUTH_GOOGLE_ID &&
      process.env.AUTH_GOOGLE_ID !== 'your-google-client-id',
  );

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="glass w-full max-w-md rounded-2xl p-8 text-center shadow-2xl">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-400 text-2xl font-bold text-[var(--color-surface)]">
          S
        </div>
        <h1 className="text-2xl font-semibold">
          {localBypass ? 'Local Hub' : 'Sign in to Sorye'}
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          {localBypass
            ? 'Development bypass is on. Continue without Google — a personal workspace is created for you.'
            : 'Your workspace OS — pick apps, connect APIs, collaborate with your team.'}
        </p>
        {banner ? (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300"
          >
            {banner}
          </p>
        ) : null}
        {!localBypass && !googleConfigured ? (
          <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            Set <code className="text-amber-200">AUTH_GOOGLE_ID</code> and{' '}
            <code className="text-amber-200">AUTH_GOOGLE_SECRET</code> in{' '}
            <code className="text-amber-200">apps/hub/.env.local</code>, or enable{' '}
            <code className="text-amber-200">AUTH_DEV_BYPASS=true</code> for local
            use.
          </p>
        ) : null}
        {localBypass ? (
          <form
            action={async () => {
              'use server';
              if (!isAuthDevBypass()) return;
              const hub = await ensureHubUser();
              if (hub) redirect(redirectTo);
            }}
            className="mt-8"
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center rounded-xl bg-sky-400 px-4 py-3 text-sm font-medium text-[var(--color-surface)] transition hover:bg-sky-300"
            >
              Continue locally
            </button>
          </form>
        ) : (
          <form
            action={async () => {
              'use server';
              await signIn('google', {
                redirectTo,
              });
            }}
            className="mt-8"
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-medium text-gray-900 transition hover:bg-gray-100"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
