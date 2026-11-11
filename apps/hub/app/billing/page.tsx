import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BillingView } from '@/components/billing/billing-view';
import { ensureHubUser } from '@/lib/ensure-user';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Plan & billing · Sorye', robots: { index: false, follow: false } };

/** Plan, usage and plan changes for the active workspace. The workspace comes from the session. */
export default async function BillingPage() {
  const session = await ensureHubUser();
  if (!session) redirect('/login?callbackUrl=/billing');
  return <BillingView workspaceName={session.workspace.name} />;
}
