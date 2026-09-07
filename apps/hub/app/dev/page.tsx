import { DevPlanForm } from '@/components/dev-plan-form';
import { getAdminEmails, getEnv } from '@/lib/env';
import { ensureHubUser } from '@/lib/ensure-user';
import { adminAssignSubscription } from '@/lib/store';
import type { SubscriptionTierId } from '@sorye/types';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';

async function setMyPlan(formData: FormData) {
  'use server';

  const env = getEnv();
  if (env.NODE_ENV !== 'development') {
    throw new Error('Dev Console is only available in development.');
  }

  const hub = await ensureHubUser();
  if (!hub?.user.email) {
    redirect('/login?callbackUrl=/dev');
  }

  const email = hub.user.email.toLowerCase();
  const admins = getAdminEmails();
  if (!admins.has(email) && !hub.user.isAdmin) {
    throw new Error('Forbidden: add your email to ADMIN_EMAILS to use /dev.');
  }

  const subscriptionId = formData.get('subscriptionId');
  if (typeof subscriptionId !== 'string') {
    throw new Error('Missing subscriptionId');
  }

  const allowed = new Set<SubscriptionTierId>([
    'free',
    'starter',
    'pro',
    'enterprise',
  ]);
  if (!allowed.has(subscriptionId as SubscriptionTierId)) {
    throw new Error('Invalid subscriptionId');
  }

  const workspace = await adminAssignSubscription(
    email,
    subscriptionId as SubscriptionTierId,
  );
  if (!workspace) {
    throw new Error(
      'User not found yet. Sign in once so your user/workspace gets created, then try again.',
    );
  }

  redirect('/');
}

function DevConsoleSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="glass rounded-2xl p-8">
        <div className="h-6 w-40 animate-pulse rounded bg-white/10" />
        <div className="mt-3 h-4 w-72 animate-pulse rounded bg-white/10" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-2xl bg-white/5"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

async function DevConsoleInner() {
  const env = getEnv();
  if (env.NODE_ENV !== 'development') {
    return (
      <div className="mx-auto max-w-xl px-6 py-10">
        <div className="glass rounded-2xl p-8 text-center">
          <h1 className="text-lg font-semibold">Dev Console</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Disabled outside development.
          </p>
        </div>
      </div>
    );
  }

  const hubSession = await ensureHubUser();
  const email = hubSession?.user.email?.toLowerCase();
  if (!email || !hubSession) {
    redirect('/login?callbackUrl=/dev');
  }

  const admins = getAdminEmails();
  if (!admins.has(email) && !hubSession.user.isAdmin) {
    return (
      <div className="mx-auto max-w-xl px-6 py-10">
        <div className="glass rounded-2xl p-8">
          <h1 className="text-lg font-semibold">Dev Console</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Add your email to{' '}
            <code className="text-[var(--color-accent)]">ADMIN_EMAILS</code> in{' '}
            <code className="text-[var(--color-accent)]">apps/hub/.env.local</code>
            , then refresh.
          </p>
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">
            Signed in as <code>{email}</code>
          </p>
          <Link
            href="/"
            className="mt-6 inline-block text-sm text-[var(--color-accent)] hover:underline"
          >
            ← Back to Hub
          </Link>
        </div>
      </div>
    );
  }

  const currentPlanId =
    hubSession.workspace.subscriptionId ?? ('free' as SubscriptionTierId);

  return (
    <DevPlanForm
      email={email}
      currentPlanId={currentPlanId}
      applyPlan={setMyPlan}
    />
  );
}

export default function DevConsolePage() {
  return (
    <Suspense fallback={<DevConsoleSkeleton />}>
      <DevConsoleInner />
    </Suspense>
  );
}
