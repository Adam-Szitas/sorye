import { HubShell } from '@/components/hub-shell';
import { ensureHubUser } from '@/lib/ensure-user';

export const dynamic = 'force-dynamic';

export default async function HubPage() {
  const initialSession = await ensureHubUser();

  return (
    <div className="relative flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden">
      <HubShell initialSession={initialSession} />
    </div>
  );
}
