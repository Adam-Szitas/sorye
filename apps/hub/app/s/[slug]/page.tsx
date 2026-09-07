import { SitePublicView } from '@/components/site-public-view';
import { getPublishedSiteBySlug } from '@/lib/site';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

function firstHeroOffer(page: { blocks: { type: string; offer?: string }[] }): string {
  const hero = page.blocks.find((block) => block.type === 'hero');
  return hero && 'offer' in hero ? (hero.offer ?? '') : '';
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPublishedSiteBySlug(slug);
  if (!page) {
    return { title: 'Not found' };
  }
  return {
    title: page.displayName,
    description: firstHeroOffer(page) || undefined,
  };
}

export default async function PublicSitePage({ params }: PageProps) {
  const { slug } = await params;
  const page = await getPublishedSiteBySlug(slug);
  if (!page) notFound();
  return <SitePublicView page={page} />;
}
