import { SharedAiConsole } from '@/components/admin/shared-ai-console';
import { adminAccess } from '@/lib/admin/access';

export const dynamic = 'force-dynamic';

export default async function AdminAiPage() {
  const access = await adminAccess();
  if (!access.ok) return null;
  return <SharedAiConsole />;
}
