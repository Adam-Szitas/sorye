import { OperationsConsole } from '@/components/admin/operations-console';
import { adminAccess } from '@/lib/admin/access';

export const dynamic = 'force-dynamic';

export default async function AdminOperationsPage() {
  const access = await adminAccess();
  if (!access.ok) return null;
  return <OperationsConsole />;
}
