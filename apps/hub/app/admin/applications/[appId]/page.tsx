import { notFound } from 'next/navigation';
import { ApplicationDetail } from '@/components/admin/settings-areas';
import { adminAccess } from '@/lib/admin/access';
import { deliveryRows } from '@/lib/admin/platform-status';
import { settingsArea } from '@/lib/admin/settings-inventory';

export const dynamic = 'force-dynamic';

export default async function AdminApplicationPage({ params }: { params: Promise<{ appId: string }> }) {
  const access = await adminAccess();
  if (!access.ok) return null;
  const { appId } = await params;
  const area = settingsArea(appId);
  if (!area) notFound();
  const row = deliveryRows().find((entry) => entry.appId === appId);
  return <ApplicationDetail area={area} delivery={row ? { kind: row.kind, source: row.source, applies: row.applies } : null} />;
}
