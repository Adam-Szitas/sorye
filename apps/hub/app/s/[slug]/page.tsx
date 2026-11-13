import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { isSiteSlug } from '@sorye/types';
import { SitePublicView } from '@/components/site-public-view';
import { projectPublishedSite } from '@/lib/site';
import { readPublishedSite } from '@/lib/rodrigo/service-client';
import { loadManifest } from '@/lib/site-cms/published';
import { bestLocale, localeBase } from '@/lib/site-cms/render';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Bare `/s/{slug}`. A site published from the CMS redirects to the visitor's best
 * Accept-Language match (temporary, private, never stored by shared caches). A site
 * that was never published from the CMS keeps its earlier one-page view unchanged.
 */
async function loadPublicSite(slug: string) {
  if (!isSiteSlug(slug)) return { kind: 'missing' as const };
  try {
    const manifest = await loadManifest(slug);
    if (manifest) return { kind: 'cms' as const, manifest };
    const resource = await readPublishedSite(slug);
    if (!resource) return { kind: 'missing' as const };
    const page = projectPublishedSite(resource);
    return page ? { kind: 'page' as const, page } : { kind: 'missing' as const };
  } catch {
    return { kind: 'unavailable' as const };
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadPublicSite(slug);
  if (loaded.kind === 'page') return { title: loaded.page.displayName };
  if (loaded.kind === 'cms') return { title: loaded.manifest.settings.name, robots: { index: false } };
  if (loaded.kind === 'unavailable') return { title: 'Site unavailable' };
  return { title: 'Page not found' };
}

export default async function PublicSitePage({ params }: PageProps) {
  const { slug } = await params;
  const loaded = await loadPublicSite(slug);
  if (loaded.kind === 'cms') {
    const locale = bestLocale(loaded.manifest.settings, (await headers()).get('accept-language'));
    redirect(`${localeBase(slug, locale)}/`);
  }
  if (loaded.kind === 'unavailable') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-[var(--color-text-muted)]">This page cannot be loaded right now.</p>
      </div>
    );
  }
  if (loaded.kind === 'missing') notFound();
  return <SitePublicView page={loaded.page} />;
}
