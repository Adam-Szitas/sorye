import { ReleasesSection } from '@/components/admin/platform-sections';
import { adminAccess } from '@/lib/admin/access';

export const dynamic = 'force-dynamic';

export default async function AdminReleasesPage() {
  const access = await adminAccess();
  if (!access.ok) return null;
  return <ReleasesSection />;
}
