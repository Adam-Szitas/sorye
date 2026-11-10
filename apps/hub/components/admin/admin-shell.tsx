'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { StandaloneAppBar } from '@/components/standalone-app-bar';
import { ADMIN_CONSOLE_CSS } from './admin-styles';

export const ADMIN_SECTIONS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/workspaces', label: 'Workspaces and access' },
  { href: '/admin/applications', label: 'Applications' },
  { href: '/admin/ai', label: 'AI and workers' },
  { href: '/admin/integrations', label: 'Integrations and storage' },
  { href: '/admin/releases', label: 'Releases and infrastructure' },
  { href: '/admin/history', label: 'Configuration history' },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({
  children,
  hubHref,
  signOutAction,
  userLabel,
  forbidden = false,
}: {
  children: React.ReactNode;
  hubHref: string;
  signOutAction: () => Promise<void>;
  userLabel: string | null;
  forbidden?: boolean;
}) {
  const pathname = usePathname() ?? '/admin';
  return (
    <div className="sorye-standalone admin-root">
      <style>{ADMIN_CONSOLE_CSS}</style>
      <StandaloneAppBar appName="Administration" hubHref={hubHref}>
        {userLabel ? <span className="admin-user" title="Signed-in platform administrator">{userLabel}</span> : null}
        <form action={signOutAction}>
          <button type="submit" className="admin-bar-button">Sign out</button>
        </form>
      </StandaloneAppBar>
      <div className="admin-layout">
        {forbidden ? null : (
          <nav aria-label="Administration sections" className="admin-nav">
            <ul>
              {ADMIN_SECTIONS.map((section) => (
                <li key={section.href}>
                  <Link
                    href={section.href}
                    aria-current={isCurrent(pathname, section.href) ? 'page' : undefined}
                    prefetch={false}
                  >
                    {section.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <main id="admin-main" className="admin-main">{children}</main>
      </div>
    </div>
  );
}
