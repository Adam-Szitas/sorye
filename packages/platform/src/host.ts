import type { HubSession } from '@sorye/types';
import { computed, readOnly, signal, type Signal } from './signals';
import { startKernelSync } from './sync';
import { navigateToApp, postKernelIntent } from './transport';
import type {
  AppFramework,
  KernelClient,
  KernelGlobalSnapshot,
  KernelMode,
  KernelSignals,
  MountedApp,
} from './types';

export interface KernelHostOptions {
  /** Clients created by this host. Standalone hosts pass `standalone`. */
  mode?: KernelMode;
  /**
   * Hub origin for cross-origin standalone (`http://localhost:3000`).
   * Omit when `/api` is same-origin.
   */
  hubOrigin?: string;
}

export interface KernelHost {
  setSession(session: HubSession | null): void;
  setNotificationUnread(count: number | null): void;
  setActiveAppId(appId: string | null): void;
  clientFor(app: { appId: string; framework: AppFramework }): KernelClient;
  listMounted(): MountedApp[];
  getState(): KernelGlobalSnapshot;
  dispose(): void;
}

/**
 * Kernel-owned global store. Hub (or a standalone client) constructs this.
 * Apps receive `KernelClient` and cannot call the setters.
 */
export function createKernelHost(options: KernelHostOptions = {}): KernelHost {
  const mode = options.mode ?? 'embedded';
  const workspaceId = signal<string | null>(null);
  const workspaceName = signal<string | null>(null);
  const workspaceKind = signal<'personal' | 'team' | null>(null);
  const selectedAppIds = signal<readonly string[]>(Object.freeze([]));
  const userId = signal<string | null>(null);
  const userDisplayName = signal<string | null>(null);
  const userEmail = signal<string | null>(null);
  const activeAppId = signal<string | null>(null);
  const notificationUnread = signal<number | null>(null);

  let mounted: MountedApp[] = [];
  let disposed = false;
  let mountSeq = 0;

  const snapshot = computed((): KernelGlobalSnapshot => {
    const id = workspaceId.value;
    const uid = userId.value;
    const unread = notificationUnread.value;
    return {
      workspace: id
        ? {
            id,
            name: workspaceName.value ?? '',
            kind: workspaceKind.value ?? 'personal',
            selectedAppIds: selectedAppIds.value,
          }
        : null,
      user: uid
        ? {
            id: uid,
            displayName: userDisplayName.value ?? '',
            email: userEmail.value ?? '',
          }
        : null,
      activeAppId: activeAppId.value,
      notifications: unread === null ? null : { unreadTotal: unread },
    };
  });

  const signals: KernelSignals = {
    workspaceName: readOnly(workspaceName),
    userDisplayName: readOnly(userDisplayName),
    activeAppId: readOnly(activeAppId),
    notificationUnread: readOnly(notificationUnread),
  };

  return {
    setSession(session) {
      if (disposed) return;
      if (!session) {
        write(workspaceId, null);
        write(workspaceName, null);
        write(workspaceKind, null);
        writeIds(selectedAppIds, []);
        write(userId, null);
        write(userDisplayName, null);
        write(userEmail, null);
        return;
      }
      write(workspaceId, session.workspace.id);
      write(workspaceName, session.workspace.name);
      write(workspaceKind, session.workspace.kind);
      writeIds(selectedAppIds, session.workspace.selectedAppIds);
      write(userId, session.user.id);
      write(userDisplayName, session.user.displayName);
      write(userEmail, session.user.email);
    },
    setNotificationUnread(count) {
      if (disposed) return;
      notificationUnread.value = count;
    },
    setActiveAppId(appId) {
      if (disposed) return;
      activeAppId.value = appId;
    },
    clientFor(app) {
      const mountId = `${app.appId}:${++mountSeq}`;
      if (!disposed) {
        mounted = [
          ...mounted,
          { mountId, appId: app.appId, framework: app.framework },
        ];
      }
      let clientDisposed = false;

      const client: KernelClient = {
        appId: app.appId,
        framework: app.framework,
        mode,
        signals,
        getState() {
          return snapshot.value;
        },
        subscribe(listener) {
          return snapshot.subscribe((state) => listener(state));
        },
        emit(intent) {
          if (disposed || clientDisposed) {
            return Promise.resolve({ ok: false, status: 0, reason: 'disposed' });
          }
          return postKernelIntent(app.appId, intent, options.hubOrigin);
        },
        navigate(request) {
          if (disposed || clientDisposed) return { ok: false, reason: 'disposed' };
          return navigateToApp(request, {
            embedded: mode === 'embedded',
            hubOrigin: options.hubOrigin,
          });
        },
        dispose() {
          if (clientDisposed) return;
          clientDisposed = true;
          mounted = mounted.filter((item) => item.mountId !== mountId);
        },
      };
      return client;
    },
    listMounted() {
      return mounted.map((item) => ({ ...item }));
    },
    getState() {
      return snapshot.value;
    },
    dispose() {
      disposed = true;
      mounted = [];
    },
  };
}

export { startKernelSync };
export { startVisibleRefresh, type VisibleRefresh } from './refresh';

function write<T>(field: Signal<T>, next: T) {
  if (!Object.is(field.peek(), next)) field.value = next;
}

function writeIds(field: Signal<readonly string[]>, next: readonly string[]) {
  const current = field.peek();
  if (current.length === next.length && current.every((id, index) => id === next[index])) return;
  field.value = Object.freeze([...next]);
}
