import { auth } from '@/auth';
import { HubShell } from '@/components/hub-shell';
import { ensureHubUser } from '@/lib/ensure-user';

export default async function HubPage() {
  const authSession = await auth();
  const initialSession =
    authSession?.user?.id ? await ensureHubUser() : null;

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <HubShell initialSession={initialSession} />
    </div>
  );
}
