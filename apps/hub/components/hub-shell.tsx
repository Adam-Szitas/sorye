'use client';

import {
  APP_CATALOG,
  HUB_MANAGE_APPS_EVENT,
  HUB_OPEN_APP_EVENT,
  SUBSCRIPTION_PLANS,
  canAddConnection,
  canSelectMoreApps,
  getPlanById,
  getSelectedApps,
  isAlwaysAvailableApp,
  selectableAppCount,
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
import { MailComposeHost } from '@/components/app-mail';
import { NotificationCenter } from '@/components/notification-center';
import { NotificationToasts } from '@/components/notification-toasts';
import { PanelSkeleton } from '@/components/panel-skeleton';
import { StatusBar } from '@/components/status-bar';
import { TopBar } from '@/components/top-bar';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import {
  NotificationProvider,
  useNotifications,
} from '@/lib/use-notifications';
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
    const leftId = parsed.leftId === 'contact' ? null : (parsed.leftId ?? null);
    const rightId =
      parsed.rightId === 'contact' ? null : (parsed.rightId ?? null);
    return {
      leftId,
      rightId,
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
    } else {
      // All panes closed → leave the (now empty) workspace view.
      setPanel((current) => (current === 'workspace' ? 'launcher' : current));
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

  const resolveApp = useCallback(
    (id: string | null) => {
      if (!id) return null;
      const app = APP_CATALOG.find((a) => a.id === id) ?? null;
      if (app?.adminOnly && !session?.user.isAdmin) return null;
      return app;
    },
    [session],
  );

  const openApp = useCallback(
    (app: AppCatalogEntry, side?: PaneSide) => {
      if (app.status !== 'available' && app.status !== 'beta') return;
      if (app.adminOnly && !session?.user.isAdmin) return;

      // No explicit side → same as before: full-page route.
      if (!side) {
        logState('app.open', { appId: app.id, mountPath: app.mountPath });
        router.push(app.mountPath);
        return;
      }

      const canMountInPane =
        Boolean(app.microFrontend) ||
        Boolean(app.external) ||
        app.alwaysAvailable === true;
      if (!canMountInPane) {
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
    [router, logState, session],
  );

  const closePane = useCallback((side: PaneSide) => {
    // Panel fallback to the launcher is handled by the panes effect above —
    // never call setPanel from inside a state updater (it can be replayed
    // under StrictMode/concurrent rendering).
    setPanes((prev) => {
      const next = {
        ...prev,
        leftId: side === 'left' ? null : prev.leftId,
        rightId: side === 'right' ? null : prev.rightId,
      };
      if ((next.leftId || next.rightId) && side === prev.focus) {
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
      if (isAlwaysAvailableApp(APP_CATALOG, appId)) return;
      const { workspace } = session;
      const isSelected = workspace.selectedAppIds.includes(appId);
      const plan = getPlanById(SUBSCRIPTION_PLANS, workspace.subscriptionId);

      let nextIds: string[];
      if (isSelected) {
        nextIds = workspace.selectedAppIds.filter((id) => id !== appId);
      } else {
        const used = selectableAppCount(APP_CATALOG, workspace.selectedAppIds);
        if (!canSelectMoreApps(plan, used)) return;
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

  return (
    <NotificationProvider
      workspaceId={workspace.id}
      onNavigateToApp={(appId) => {
        const app = APP_CATALOG.find((a) => a.id === appId);
        if (!app) return;
        if (app.adminOnly && !session.user.isAdmin) return;
        if (app.status !== 'available' && app.status !== 'beta') return;
        if (app.microFrontend || app.external || app.alwaysAvailable) {
          setPanel('workspace');
          openApp(app, 'left');
        } else {
          router.push(app.mountPath);
        }
      }}
    >
      <HubShellLoaded
        session={session}
        workspace={workspace}
        user={user}
        workspaces={workspaces}
        plan={plan}
        panel={panel}
        setPanel={setPanel}
        panes={panes}
        setPanes={setPanes}
        panesReady={panesReady}
        navigatePanel={navigatePanel}
        openApp={openApp}
        closePane={closePane}
        expandPane={expandPane}
        swapPanes={swapPanes}
        movePane={movePane}
        closeWorkspace={closeWorkspace}
        resolveApp={resolveApp}
        toggleApp={toggleApp}
        addConnection={addConnection}
        removeConnection={removeConnection}
        logState={logState}
        switchWorkspace={switchWorkspace}
        createTeam={createTeam}
        signOut={() => {
          logState('auth.signOut');
          signOut({ callbackUrl: '/login' });
        }}
      />
    </NotificationProvider>
  );
}

interface HubShellLoadedProps {
  session: HubSession;
  workspace: HubSession['workspace'];
  user: HubSession['user'];
  workspaces: HubSession['workspaces'];
  plan: ReturnType<typeof getPlanById>;
  panel: Panel;
  setPanel: (p: Panel) => void;
  panes: PaneState;
  setPanes: React.Dispatch<React.SetStateAction<PaneState>>;
  panesReady: boolean;
  navigatePanel: (next: Panel) => void;
  openApp: (app: AppCatalogEntry, side?: PaneSide) => void;
  closePane: (side: PaneSide) => void;
  expandPane: (side: PaneSide) => void;
  swapPanes: () => void;
  movePane: (side: PaneSide) => void;
  closeWorkspace: () => void;
  resolveApp: (id: string | null) => AppCatalogEntry | null;
  toggleApp: (appId: string) => void;
  addConnection: (
    connection: Omit<ConnectedApp, 'id' | 'connectedAt' | 'status'>,
  ) => Promise<void>;
  removeConnection: (connectionId: string) => Promise<void>;
  logState: (action: string, extra?: Record<string, unknown>) => void;
  switchWorkspace: (workspaceId: string) => Promise<HubSession>;
  createTeam: (name: string) => Promise<HubSession>;
  signOut: () => void;
}

function HubShellLoaded({
  workspace,
  user,
  workspaces,
  plan,
  panel,
  setPanel,
  panes,
  setPanes,
  navigatePanel,
  openApp: openAppBase,
  closePane,
  expandPane,
  swapPanes,
  movePane,
  closeWorkspace,
  resolveApp,
  toggleApp,
  addConnection,
  removeConnection,
  logState,
  switchWorkspace,
  createTeam,
  signOut,
}: HubShellLoadedProps) {
  const {
    unreadByApp,
    unreadTotal,
    openCenter,
    markAppRead,
  } = useNotifications();

  const openApp = useCallback(
    (app: AppCatalogEntry, side?: PaneSide) => {
      void markAppRead(app.id);
      openAppBase(app, side);
    },
    [markAppRead, openAppBase],
  );

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<{ appId?: string; side?: PaneSide }>)
        .detail;
      const app = APP_CATALOG.find((entry) => entry.id === detail?.appId);
      if (!app) return;
      openApp(app, detail.side);
    }
    function onManage() {
      navigatePanel('picker');
    }
    window.addEventListener(HUB_OPEN_APP_EVENT, onOpen);
    window.addEventListener(HUB_MANAGE_APPS_EVENT, onManage);
    return () => {
      window.removeEventListener(HUB_OPEN_APP_EVENT, onOpen);
      window.removeEventListener(HUB_MANAGE_APPS_EVENT, onManage);
    };
  }, [openApp, navigatePanel]);

  const selectedApps = getSelectedApps(APP_CATALOG, workspace.selectedAppIds, {
    isAdmin: user.isAdmin,
  });
  const leftApp = resolveApp(panes.leftId);
  const rightApp = resolveApp(panes.rightId);
  const workspaceOpen = Boolean(leftApp || rightApp);
  return (
    <>
      <TopBar
        user={user}
        workspace={workspace}
        plan={plan}
        notificationCount={unreadTotal}
        onOpenNotifications={openCenter}
        onOpenPicker={() => {
          logState('panel.open', { panel: 'picker' });
          setPanel('picker');
        }}
        onOpenConnections={() => {
          logState('panel.open', { panel: 'connections' });
          setPanel('connections');
        }}
        onSignOut={signOut}
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
        className={`flex min-h-0 flex-1 flex-col px-4 pt-4 sm:px-8 ${
          panel === 'workspace'
            ? 'overflow-hidden pb-24'
            : 'overflow-y-auto pb-28'
        }`}
      >
        {panel === 'launcher' && (
          <AppLauncher
            apps={selectedApps}
            plan={plan}
            openLeftId={panes.leftId}
            openRightId={panes.rightId}
            unreadByApp={unreadByApp}
            onOpenApp={openApp}
            onManageApps={() => navigatePanel('picker')}
          />
        )}

        {workspaceOpen ? (
          // Kept mounted (hidden) while picker/connections/launcher are open
          // so Module Federation remotes keep their in-app state.
          <div
            className={`min-h-0 flex-1 flex-col gap-3 ${
              panel === 'workspace' ? 'flex' : 'hidden'
            }`}
          >
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
                      (a.microFrontend || a.external || a.alwaysAvailable),
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
            isAdmin={user.isAdmin}
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
        notificationCount={unreadTotal}
        onNavigate={navigatePanel}
        workspaceOpen={workspaceOpen}
        onOpenWorkspace={() => navigatePanel('workspace')}
      />

      <StatusBar
        plan={plan}
        selectedCount={selectableAppCount(APP_CATALOG, workspace.selectedAppIds)}
        connectionCount={workspace.connectedApps.length}
        workspaceKind={workspace.kind}
      />

      <NotificationCenter />
      <NotificationToasts />
      <MailComposeHost />
    </>
  );
}
