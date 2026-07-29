import type { SubscriptionTierId, SubscriptionSource } from './subscription';
import type { WorkspaceStoragePublic } from './storage';
import { DEFAULT_WORKSPACE_STORAGE } from './storage';

export type WorkspaceKind = 'personal' | 'team';

export type ConnectionStatus = 'active' | 'pending' | 'error';

export interface ConnectedApp {
  id: string;
  name: string;
  endpoint: string;
  apiKeyHint: string;
  status: ConnectionStatus;
  connectedAt: string;
  scopes: string[];
}

export interface Workspace {
  id: string;
  kind: WorkspaceKind;
  name: string;
  ownerId: string;
  memberIds: string[];
  subscriptionId: SubscriptionTierId;
  subscriptionSource: SubscriptionSource;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  selectedAppIds: string[];
  connectedApps: ConnectedApp[];
  storage?: WorkspaceStoragePublic;
  updatedAt: string;
}

export interface HubUser {
  id: string;
  email: string;
  displayName: string;
  image?: string;
  personalWorkspaceId: string;
  teamWorkspaceIds: string[];
  activeWorkspaceId: string;
  isAdmin: boolean;
}

export interface WorkspaceSummary {
  id: string;
  kind: WorkspaceKind;
  name: string;
}

export interface HubSession {
  user: HubUser;
  workspace: Workspace;
  workspaces: WorkspaceSummary[];
}

/** @deprecated Use Workspace — kept for gradual migration */
export interface UserWorkspace {
  userId: string;
  displayName: string;
  email: string;
  subscriptionId: SubscriptionTierId;
  selectedAppIds: string[];
  connectedApps: ConnectedApp[];
  updatedAt: string;
}

export function trimWorkspaceToPlanLimits(
  workspace: Workspace,
  maxApps: number,
  maxConnections: number,
): Workspace {
  return {
    ...workspace,
    selectedAppIds:
      workspace.selectedAppIds.length > maxApps
        ? workspace.selectedAppIds.slice(0, maxApps)
        : workspace.selectedAppIds,
    connectedApps:
      workspace.connectedApps.length > maxConnections
        ? workspace.connectedApps.slice(0, maxConnections)
        : workspace.connectedApps,
    updatedAt: new Date().toISOString(),
  };
}
