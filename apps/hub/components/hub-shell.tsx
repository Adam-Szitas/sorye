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
import {
  AppWorkspace,
  type PaneSide,
} from '@/components/app-workspace';
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

type Panel = 'launcher' | 'picker' | 'connections' | 'workspace';

const PANES_STORAGE_KEY = 'sorye:hub:panes';

interface PaneState {
  leftId: string | null;
  rightId: string | null;
  focus: PaneSide;
}

function readPaneState(): PaneState {
  if (typeof window === 'undefined') {
    return { leftId: null, rightId: null, focus: 'left' };
  }
  try {
    const raw = sessionStorage.getItem(PANES_STORAGE_KEY);
    if (!raw) return { leftId: null, rightId: null, focus: 'left' };
    const parsed = JSON.parse(raw) as PaneState;
    return {
      leftId: parsed.leftId ?? null,
      rightId: parsed.rightId ?? null,
      focus: parsed.focus === 'right' ? 'right' : 'left',
    };
  } catch {
    return { leftId: null, rightId: null, focus: 'left' };
  }
}

interface HubShellProps {
  initialSession?: HubSession | null;
}

export function HubShell({ initialSession }: HubShellProps) {
  const router = useRouter();
  const { session, loading, error, patchWorkspace, switchWorkspace, createTeam } =
    useHubSession({ initialData: initialSession });
  const [panel, setPanel] = useState<Panel>('launcher');
  const [panes, setPanes] = useState<PaneState>({
    leftId: null,
    rightId: null,
    focus: 'left',
  });
  const [panesReady, setPanesReady] = useState(false);

  useEffect(() => {
    setPanes(readPaneState());
    setPanesReady(true);
  }, []);

  useEffect(() => {
    if (!panesReady) return;
    sessionStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(panes));
  }, [panes, panesReady]);

  useEffect(() => {
    if (!panesReady) return;
    if (panes.leftId || panes.rightId) {
      setPanel('workspace');
    }
  }, [panesReady, panes.leftId, panes.rightId]);

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

  const resolveApp = useCallback((id: string | null) => {
    if (!id) return null;
    return APP_CATALOG.find((a) => a.id === id) ?? null;
  }, []);

  const openApp = useCallback(
    (app: AppCatalogEntry, side?: PaneSide) => {
      if (app.status !== 'available' && app.status !== 'beta') return;

      // No explicit side → same as before: full-page route.
      if (!side) {
        logState('app.open', { appId: app.id, mountPath: app.mountPath });
        router.push(app.mountPath);
        return;
      }

      if (!app.microFrontend && !app.external) {
        router.push(app.mountPath);
        return;
      }

      setPanes((prev) => {
        let leftId = prev.leftId;
        let rightId = prev.rightId;
        let focus: PaneSide = side;

        if (side === 'left') {
          if (rightId === app.id) rightId = null;
          leftId = app.id;
        } else {
          if (leftId === app.id) leftId = null;
          rightId = app.id;
        }

        return { leftId, rightId, focus };
      });
      setPanel('workspace');
      logState('app.open.split', { appId: app.id, side });
    },
    [router, logState],
  );

  const closePane = useCallback((side: PaneSide) => {
    setPanes((prev) => {
      const next = {
        ...prev,
        leftId: side === 'left' ? null : prev.leftId,
        rightId: side === 'right' ? null : prev.rightId,
      };
      if (!next.leftId && !next.rightId) {
        setPanel('launcher');
      } else if (side === prev.focus) {
        next.focus = next.leftId ? 'left' : 'right';
      }
      return next;
    });
  }, []);

  const expandPane = useCallback((side: PaneSide) => {
    setPanes((prev) => ({
      leftId: side === 'left' ? prev.leftId : null,
      rightId: side === 'right' ? prev.rightId : null,
      focus: side,
    }));
  }, []);

  const swapPanes = useCallback(() => {
    setPanes((prev) => ({
      leftId: prev.rightId,
      rightId: prev.leftId,
      focus: prev.focus === 'left' ? 'right' : 'left',
    }));
  }, []);

  const movePane = useCallback((side: PaneSide) => {
    setPanes((prev) => {
      if (side === 'left' && prev.leftId) {
        return {
          leftId: prev.rightId,
          rightId: prev.leftId,
          focus: 'right',
        };
      }
      if (side === 'right' && prev.rightId) {
        return {
          leftId: prev.rightId,
          rightId: prev.leftId,
          focus: 'left',
        };
      }
      return prev;
    });
  }, []);

  const closeWorkspace = useCallback(() => {
    setPanes({ leftId: null, rightId: null, focus: 'left' });
    setPanel('launcher');
  }, []);

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
  const leftApp = resolveApp(panes.leftId);
  const rightApp = resolveApp(panes.rightId);
  const workspaceOpen = Boolean(leftApp || rightApp);

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

      <main
        className={`flex flex-1 flex-col px-4 pt-4 sm:px-8 ${
          panel === 'workspace'
            ? 'min-h-0 pb-24'
            : 'pb-28'
        }`}
      >
        {panel === 'launcher' && (
          <AppLauncher
            apps={selectedApps}
            plan={plan}
            openLeftId={panes.leftId}
            openRightId={panes.rightId}
            onOpenApp={openApp}
            onManageApps={() => navigatePanel('picker')}
          />
        )}

        {panel === 'workspace' && workspaceOpen ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigatePanel('launcher')}
                className="rounded-lg bg-white/8 px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/12 hover:text-[var(--color-text)]"
              >
                ← App grid
              </button>
              <button
                type="button"
                onClick={closeWorkspace}
                className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-red-300"
              >
                Close all
              </button>
              <div className="ml-auto flex flex-wrap gap-1">
                {selectedApps
                  .filter(
                    (a) =>
                      a.id !== panes.leftId &&
                      a.id !== panes.rightId &&
                      (a.microFrontend || a.external),
                  )
                  .slice(0, 6)
                  .map((app) => (
                    <div key={app.id} className="flex overflow-hidden rounded-lg bg-white/6">
                      <button
                        type="button"
                        onClick={() => openApp(app, 'left')}
                        className="px-2 py-1 text-[11px] text-[var(--color-text-muted)] transition hover:bg-white/12 hover:text-[var(--color-text)]"
                        title={`Open ${app.name} on the left`}
                      >
                        L {app.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => openApp(app, 'right')}
                        className="border-l border-white/10 px-2 py-1 text-[11px] text-[var(--color-text-muted)] transition hover:bg-white/12 hover:text-[var(--color-text)]"
                        title={`Open ${app.name} on the right`}
                      >
                        R
                      </button>
                    </div>
                  ))}
              </div>
            </div>
            <AppWorkspace
              left={leftApp}
              right={rightApp}
              focus={panes.focus}
              onFocus={(side) =>
                setPanes((prev) => ({ ...prev, focus: side }))
              }
              onClose={closePane}
              onExpand={expandPane}
              onSwap={swapPanes}
              onMove={movePane}
            />
          </div>
        ) : null}

        {panel === 'picker' && (
          <AppPicker
            catalog={APP_CATALOG}
            selectedIds={workspace.selectedAppIds}
            plan={plan}
            subscriptionSource={workspace.subscriptionSource}
            onToggleApp={toggleApp}
            onClose={() =>
              navigatePanel(workspaceOpen ? 'workspace' : 'launcher')
            }
          />
        )}

        {panel === 'connections' && (
          <ConnectionsPanel
            connections={workspace.connectedApps}
            selectedAppIds={workspace.selectedAppIds}
            plan={plan}
            onAdd={addConnection}
            onRemove={removeConnection}
            onClose={() =>
              navigatePanel(workspaceOpen ? 'workspace' : 'launcher')
            }
          />
        )}
      </main>

      <Dock
        activePanel={
          panel === 'picker' || panel === 'connections' ? panel : 'launcher'
        }
        appCount={selectedApps.length}
        connectionCount={workspace.connectedApps.length}
        onNavigate={navigatePanel}
        workspaceOpen={workspaceOpen}
        onOpenWorkspace={() => navigatePanel('workspace')}
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
