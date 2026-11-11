import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { translate } from '@sorye/platform';
import { isFormSlug } from '@sorye/types';
import { FormPublicView, FormUnavailable } from '@/components/form-public-view';
import { preferredLocale } from '@/lib/preferred-locale';
import { readPublishedForm } from '@/lib/rodrigo/service-client';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function loadPublicForm(slug: string) {
  if (!isFormSlug(slug)) return { kind: 'missing' as const };
  try {
    const form = await readPublishedForm(slug);
    return form ? { kind: 'form' as const, form } : { kind: 'missing' as const };
  } catch {
    return { kind: 'unavailable' as const };
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadPublicForm(slug);
  // Answers pages are for the people who were given the link, not for search results.
  const robots = { index: false, follow: false };
  if (loaded.kind === 'form') return { title: loaded.form.title, robots };
  // The visitor's chosen language lives in their browser; the tab title follows the browser preference.
  const locale = preferredLocale((await headers()).get('accept-language'));
  return { title: translate(locale, loaded.kind === 'unavailable' ? 'forms.public.unavailableTitle' : 'forms.public.notFoundTitle'), robots };
}

export default async function PublicFormPage({ params }: PageProps) {
  const { slug } = await params;
  const loaded = await loadPublicForm(slug);
  if (loaded.kind === 'unavailable') return <FormUnavailable />;
  if (loaded.kind === 'missing') notFound();
  return <FormPublicView form={loaded.form} />;
}
