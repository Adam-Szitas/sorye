import { OperatorPanels } from '@/components/admin/operator-panels';
import { OverviewStatus } from '@/components/admin/platform-sections';
import { adminAccess } from '@/lib/admin/access';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const access = await adminAccess();
  if (!access.ok) return null;
  return (
    <>
      <div className="admin-page"><OverviewStatus /></div>
      <OperatorPanels
        sections={['health', 'errors', 'activity', 'usage', 'load']}
        title="Overview"
        intro="Platform health, errors and usage. Counts and names only; document text, prompts and message bodies stay out of this view."
      />
    </>
  );
}
