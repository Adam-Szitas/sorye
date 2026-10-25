import type { WorkspaceEventName, WorkspaceEventPayload, HandoffKind } from '@sorye/types';
import type { ReadonlySignal } from './signals';

export type AppFramework = 'react' | 'vue' | 'angular' | 'lit';

export type KernelMode = 'embedded' | 'standalone';

/** Fields the Hub session and notification feed already expose. Read-only for apps. */
export interface KernelGlobalSnapshot {
  workspace: {
    id: string;
    name: string;
    kind: 'personal' | 'team';
    selectedAppIds: readonly string[];
  } | null;
  user: {
    id: string;
    displayName: string;
    email: string;
  } | null;
  /** App focused in the shell, or the standalone app itself. */
  activeAppId: string | null;
  notifications: {
    unreadTotal: number;
  } | null;
}

export interface KernelSignals {
  readonly workspaceName: ReadonlySignal<string | null>;
  readonly userDisplayName: ReadonlySignal<string | null>;
  readonly activeAppId: ReadonlySignal<string | null>;
  readonly notificationUnread: ReadonlySignal<number | null>;
}

export interface KernelEventIntent {
  type: 'event';
  name: WorkspaceEventName;
  payload: WorkspaceEventPayload;
}

export interface KernelHandoffIntent {
  type: 'handoff';
  targetAppId: string;
  kind: HandoffKind;
  title: string;
  summary?: string;
  payload: unknown;
}

export type KernelIntent = KernelEventIntent | KernelHandoffIntent;

export interface KernelEmitResult {
  ok: boolean;
  status: number;
  delivered?: boolean;
  reason?: string;
}

export interface KernelNavigateRequest {
  appId: string;
  /** Embedded shell only. Standalone opens the Hub route for `appId`. */
  side?: 'left' | 'right';
}

export interface KernelNavigateResult {
  ok: boolean;
  reason?:
    | 'disposed'
    | 'standalone-needs-hub-origin'
    | 'unknown-app'
    | 'no-window';
}

export interface KernelClient {
  readonly appId: string;
  readonly framework: AppFramework;
  readonly mode: KernelMode;
  readonly signals: KernelSignals;
  getState(): KernelGlobalSnapshot;
  subscribe(listener: (state: KernelGlobalSnapshot) => void): () => void;
  /** Posts through Hub `/api/events` or `/api/handoffs`. Does not accept a workspace id. */
  emit(intent: KernelIntent): Promise<KernelEmitResult>;
  navigate(request: KernelNavigateRequest): KernelNavigateResult;
  /** Drops this mount. Does not tear down kernel signals owned by Hub. */
  dispose(): void;
}

/** Passed as the second argument to a remote `mount`. Older remotes may ignore it. */
export interface KernelMountContext {
  kernel: KernelClient;
}

export interface MountedApp {
  mountId: string;
  appId: string;
  framework: AppFramework;
}
