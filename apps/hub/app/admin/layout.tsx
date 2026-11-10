import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { signOut } from '@/auth';
import { AdminShell } from '@/components/admin/admin-shell';
import { adminAccess } from '@/lib/admin/access';
import { customerOrigin, effectiveHost } from '@/lib/admin/hosts';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sorye administration',
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await adminAccess();
  if (!access.ok && access.status === 404) notFound();
  if (!access.ok && access.status === 401) redirect('/login?callbackUrl=%2Fadmin');

  const hdrs = await headers();
  const proto = hdrs.get('x-forwarded-proto') ?? 'http';
  const hubHref = `${customerOrigin(effectiveHost(hdrs).host, proto)}/`;

  async function signOutAction() {
    'use server';
    await signOut({ redirectTo: '/login?callbackUrl=%2Fadmin' });
  }

  if (!access.ok) {
    return (
      <AdminShell hubHref={hubHref} signOutAction={signOutAction} userLabel={null} forbidden>
        <section aria-labelledby="admin-forbidden-title" className="flex flex-col gap-3 p-6">
          <h1 id="admin-forbidden-title" className="text-2xl font-semibold">Not a platform administrator</h1>
          <p className="max-w-xl text-sm text-[var(--color-text-muted)]">
            You are signed in, but this account is not on the platform administrator list. Sign out and use an administrator account, or go back to your workspace.
          </p>
        </section>
      </AdminShell>
    );
  }

  const { user } = access.actor.session;
  return (
    <AdminShell hubHref={hubHref} signOutAction={signOutAction} userLabel={user.displayName || user.email}>
      {children}
    </AdminShell>
  );
}
