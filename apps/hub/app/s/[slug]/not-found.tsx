import Link from 'next/link';

export default function PublicSiteNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
      <p className="text-sm text-[var(--color-text-muted)]">Page not found.</p>
      <Link
        href="/"
        className="rounded-xl bg-white/10 px-4 py-2 text-sm transition hover:bg-white/15"
      >
        Sorye
      </Link>
    </div>
  );
}
