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
import { useCallback, useEffect, useState } from 'react';
import { AppLauncher } from '@/components/app-launcher';
import { Dock } from '@/components/dock';
import { PanelSkeleton } from '@/components/panel-skeleton';
import { StatusBar } from '@/components/status-bar';
import { TopBar } from '@/components/top-bar';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { useHubSession } from '@/lib/use-hub-session';
import { getClientFeatureFlags } from '@/lib/feature-flags';
import { logHubInteraction } from '@/lib/hub-state-logger';

const featureFlags = getClientFeatureFlags();

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
  const { session, loading, error, patchWorkspace, switchWorkspace, createTeam } =
    useHubSession({ initialData: initialSession });
  const [panel, setPanel] = useState<Panel>('launcher');

  const logState = useCallback(
    (action: string, extra?: Record<string, unknown>) => {
      if (!featureFlags.showLogs) return;
      logHubInteraction(action, session ?? null, extra);
    },
    [session],
  );

  const navigatePanel = useCallback(
    (next: Panel) => {
      setPanel(next);
      logState('panel.change', { panel: next });
    },
    [logState],
  );

  useEffect(() => {
    if (!featureFlags.showLogs || !session) return;
    logHubInteraction('session.loaded', session);
  }, [session]);

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/login');
    }
  }, [loading, session, router]);

  const openApp = useCallback(
    (app: AppCatalogEntry) => {
      if (app.status !== 'available') return;
      logState('app.open', { appId: app.id, mountPath: app.mountPath });
      router.push(app.mountPath);
    },
    [router, logState],
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
      logState('apps.toggle', { appId, selected: !isSelected, selectedAppIds: nextIds });
    },
    [session, patchWorkspace, logState],
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
      logState('connection.add', { name: connection.name });
    },
    [session, patchWorkspace, logState],
  );

  const removeConnection = useCallback(
    async (connectionId: string) => {
      if (!session) return;
      await patchWorkspace({
        connectedApps: session.workspace.connectedApps.filter(
          (c) => c.id !== connectionId,
        ),
      });
      logState('connection.remove', { connectionId });
    },
    [session, patchWorkspace, logState],
  );

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--color-surface)]">
        <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--color-surface)] px-6 text-center">
        <p className="text-sm text-red-400">Could not load workspace: {error}</p>
        <button
          type="button"
          onClick={() => router.push('/login')}
          className="rounded-xl bg-white/10 px-4 py-2 text-sm transition hover:bg-white/15"
        >
          Go to sign in
        </button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--color-surface)]">
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
        onOpenPicker={() => {
          logState('panel.open', { panel: 'picker' });
          setPanel('picker');
        }}
        onOpenConnections={() => {
          logState('panel.open', { panel: 'connections' });
          setPanel('connections');
        }}
        onSignOut={() => {
          logState('auth.signOut');
          signOut({ callbackUrl: '/login' });
        }}
      />

      <div className="flex justify-center px-4 pt-3 sm:px-8">
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={workspace.id}
          plan={plan}
          onSwitch={async (workspaceId) => {
            await switchWorkspace(workspaceId);
            logState('workspace.switch', { workspaceId });
          }}
          onCreateTeam={async (name) => {
            await createTeam(name);
            logState('workspace.createTeam', { name });
          }}
        />
      </div>

      <main className="flex flex-1 flex-col px-4 pb-28 pt-4 sm:px-8">
        {panel === 'launcher' && (
          <AppLauncher
            apps={selectedApps}
            plan={plan}
            onOpenApp={openApp}
            onManageApps={() => navigatePanel('picker')}
          />
        )}

        {panel === 'picker' && (
          <AppPicker
            catalog={APP_CATALOG}
            selectedIds={workspace.selectedAppIds}
            plan={plan}
            subscriptionSource={workspace.subscriptionSource}
            onToggleApp={toggleApp}
            onClose={() => navigatePanel('launcher')}
          />
        )}

        {panel === 'connections' && (
          <ConnectionsPanel
            connections={workspace.connectedApps}
            selectedAppIds={workspace.selectedAppIds}
            plan={plan}
            onAdd={addConnection}
            onRemove={removeConnection}
            onClose={() => navigatePanel('launcher')}
          />
        )}
      </main>

      <Dock
        activePanel={panel}
        appCount={selectedApps.length}
        connectionCount={workspace.connectedApps.length}
        onNavigate={navigatePanel}
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
