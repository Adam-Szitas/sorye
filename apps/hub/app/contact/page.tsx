import { AppContact } from '@/components/app-contact';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const NAV_LINK =
  'rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]';

export default function ContactPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="glass sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4 sm:px-8">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          Sorye
        </Link>
        <nav className="flex flex-wrap items-center gap-1" aria-label="Site">
          <Link
            href="/contact"
            aria-current="page"
            className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
          >
            Contact
          </Link>
          <Link href="/architecture" className={NAV_LINK}>
            Architecture
          </Link>
          <Link href="/login" className={NAV_LINK}>
            Sign in
          </Link>
        </nav>
      </header>
      <main className="flex flex-1 flex-col">
        <AppContact />
      </main>
    </div>
  );
}
