import { redirect, notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { APP_CATALOG } from '@sorye/types';
import { preferredLocale } from '@/lib/preferred-locale';
export default async function LandingRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!APP_CATALOG.some(app => app.slug === slug)) notFound();
  const locale = preferredLocale((await headers()).get('accept-language'));
  redirect(`/learn/${slug}/${locale}`);
}
