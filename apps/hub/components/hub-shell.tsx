'use client';

import {
  APP_CATALOG,
  SUBSCRIPTION_PLANS,
  canAddConnection,
  canSelectMoreApps,
  getPlanById,
  getSelectedApps,
  type AppCatalogEntry,
  type ConnectedApp,
  type HubSession,
} from '@sorye/types';
import dynamic from 'next/dynamic';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { AppLauncher } from '@/components/app-launcher';
import { Dock } from '@/components/dock';
import { PanelSkeleton } from '@/components/panel-skeleton';
import { StatusBar } from '@/components/status-bar';
import { TopBar } from '@/components/top-bar';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { useHubSession } from '@/lib/use-hub-session';

const AppPicker = dynamic(
  () =>
    import('@/components/app-picker').then((mod) => ({
      default: mod.AppPicker,
    })),
  { loading: () => <PanelSkeleton /> },
);

const ConnectionsPanel = dynamic(
  () =>
    import('@/components/connections-panel').then((mod) => ({
      default: mod.ConnectionsPanel,
    })),
  { loading: () => <PanelSkeleton /> },
);

type Panel = 'launcher' | 'picker' | 'connections';

interface HubShellProps {
  initialSession?: HubSession | null;
}

export function HubShell({ initialSession }: HubShellProps) {
  const router = useRouter();
  const { session, loading, patchWorkspace, switchWorkspace, createTeam } =
    useHubSession({ initialData: initialSession });
  const [panel, setPanel] = useState<Panel>('launcher');

  const openApp = useCallback(
    (app: AppCatalogEntry) => {
      if (app.status !== 'available') return;
      router.push(app.mountPath);
    },
    [router],
  );

  const toggleApp = useCallback(
    async (appId: string) => {
      if (!session) return;
      const { workspace } = session;
      const isSelected = workspace.selectedAppIds.includes(appId);
      const plan = getPlanById(SUBSCRIPTION_PLANS, workspace.subscriptionId);

      let nextIds: string[];
      if (isSelected) {
        nextIds = workspace.selectedAppIds.filter((id) => id !== appId);
      } else {
        if (!canSelectMoreApps(plan, workspace.selectedAppIds.length)) return;
        nextIds = [...workspace.selectedAppIds, appId];
      }

      await patchWorkspace({ selectedAppIds: nextIds });
    },
    [session, patchWorkspace],
  );

  const addConnection = useCallback(
    async (connection: Omit<ConnectedApp, 'id' | 'connectedAt' | 'status'>) => {
      if (!session) return;
      const plan = getPlanById(
        SUBSCRIPTION_PLANS,
        session.workspace.subscriptionId,
      );
      if (!canAddConnection(plan, session.workspace.connectedApps.length)) {
        return;
      }

      await patchWorkspace({
        connectedApps: [
          ...session.workspace.connectedApps,
          {
            ...connection,
            id: `conn-${crypto.randomUUID().slice(0, 8)}`,
            status: 'active' as const,
            connectedAt: new Date().toISOString(),
          },
        ],
      });
    },
    [session, patchWorkspace],
  );

  const removeConnection = useCallback(
    async (connectionId: string) => {
      if (!session) return;
      await patchWorkspace({
        connectedApps: session.workspace.connectedApps.filter(
          (c) => c.id !== connectionId,
        ),
      });
    },
    [session, patchWorkspace],
  );

  if (loading || !session) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
      </div>
    );
  }

  const { workspace, user, workspaces } = session;
  const plan = getPlanById(SUBSCRIPTION_PLANS, workspace.subscriptionId);
  const selectedApps = getSelectedApps(APP_CATALOG, workspace.selectedAppIds);

  return (
    <>
      <TopBar
        user={user}
        workspace={workspace}
        plan={plan}
        onOpenPicker={() => setPanel('picker')}
        onOpenConnections={() => setPanel('connections')}
        onSignOut={() => signOut({ callbackUrl: '/login' })}
      />

      <div className="flex justify-center px-4 pt-3 sm:px-8">
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={workspace.id}
          plan={plan}
          onSwitch={switchWorkspace}
          onCreateTeam={createTeam}
        />
      </div>

      <main className="flex flex-1 flex-col px-4 pb-28 pt-4 sm:px-8">
        {panel === 'launcher' && (
          <AppLauncher
            apps={selectedApps}
            plan={plan}
            onOpenApp={openApp}
            onManageApps={() => setPanel('picker')}
          />
        )}

        {panel === 'picker' && (
          <AppPicker
            catalog={APP_CATALOG}
            selectedIds={workspace.selectedAppIds}
            plan={plan}
            subscriptionSource={workspace.subscriptionSource}
            onToggleApp={toggleApp}
            onClose={() => setPanel('launcher')}
          />
        )}

        {panel === 'connections' && (
          <ConnectionsPanel
            connections={workspace.connectedApps}
            plan={plan}
            onAdd={addConnection}
            onRemove={removeConnection}
            onClose={() => setPanel('launcher')}
          />
        )}
      </main>

      <Dock
        activePanel={panel}
        appCount={selectedApps.length}
        connectionCount={workspace.connectedApps.length}
        onNavigate={setPanel}
      />

      <StatusBar
        plan={plan}
        selectedCount={workspace.selectedAppIds.length}
        connectionCount={workspace.connectedApps.length}
        workspaceKind={workspace.kind}
      />
    </>
  );
}
