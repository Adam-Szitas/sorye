import { HistorySection } from '@/components/admin/platform-sections';
import { adminAccess } from '@/lib/admin/access';

export const dynamic = 'force-dynamic';

export default async function AdminHistoryPage() {
  const access = await adminAccess();
  if (!access.ok) return null;
  return <HistorySection />;
}
