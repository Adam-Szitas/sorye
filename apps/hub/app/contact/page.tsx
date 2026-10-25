import { AppContact } from '@/components/app-contact';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function ContactPage() {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <header className="glass flex shrink-0 items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-[var(--color-text)]"
        >
          Sorye
        </Link>
        <nav className="flex items-center gap-1">
          <Link
            href="/architecture"
            className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
          >
            Architecture
          </Link>
          <Link
            href="/login"
            className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
          >
            Sign in
          </Link>
        </nav>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AppContact />
      </div>
    </div>
  );
}
