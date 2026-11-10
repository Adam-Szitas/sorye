import { ApplicationsIndex } from '@/components/admin/settings-areas';
import { adminAccess } from '@/lib/admin/access';
import { deliveryRows } from '@/lib/admin/platform-status';
import { SETTINGS_INVENTORY } from '@/lib/admin/settings-inventory';

export const dynamic = 'force-dynamic';

export default async function AdminApplicationsPage() {
  const access = await adminAccess();
  if (!access.ok) return null;
  const delivery = Object.fromEntries(deliveryRows().map((row) => [row.appId, { kind: row.kind, source: row.source, applies: row.applies }]));
  return <ApplicationsIndex areas={SETTINGS_INVENTORY} delivery={delivery} />;
}
