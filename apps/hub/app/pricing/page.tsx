import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { translate } from '@sorye/platform';
import { PricingView } from '@/components/billing/pricing-view';
import { preferredLocale } from '@/lib/preferred-locale';

export async function generateMetadata(): Promise<Metadata> {
  const locale = preferredLocale((await headers()).get('accept-language'));
  return {
    title: `${translate(locale, 'billing.pricingTitle')} · Sorye`,
    description: `${translate(locale, 'billing.pricingLead')} ${translate(locale, 'billing.vatNote')}`,
  };
}

export default function PricingPage() {
  return <PricingView />;
}
