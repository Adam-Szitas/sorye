import type { SubscriptionTierId } from './subscription';
import type { WorkspaceKind } from './workspace';

/** Who may see a platform notice. `all` is every signed-in user. */
export type OperatorNoticeAudience = 'all' | SubscriptionTierId;

/** Notice text returned to a signed-in user. No audience, schedule, or drafts. */
export interface OperatorNoticeMessage {
  id: string;
  message: string;
}

export interface OperatorNoticeRecord {
  id: string;
  message: string;
  audience: OperatorNoticeAudience;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  createdAt: string;
}

export interface OperatorPlanSchedule {
  subscriptionId: SubscriptionTierId;
  effectiveAt: string;
  note: string | null;
}

export interface OperatorWorkspaceRow {
  id: string;
  name: string;
  kind: WorkspaceKind;
  subscriptionId: SubscriptionTierId;
  planName: string;
  maxApps: number;
  selectedAppCount: number;
  schedule: OperatorPlanSchedule | null;
}

export interface OperatorActivityItem {
  appId: string;
  eventName: string;
  at: string;
  workspaceName: string;
  ok: boolean;
}

export interface OperatorUsagePoint {
  bucket: string;
  opens: number;
  jobs: number;
  errors: number;
  activeWorkspaces: number;
}

export interface OperatorAppLoad {
  appId: string;
  requests: number;
  jobs: number;
  errors: number;
  durationCount: number;
  durationAvgMs: number | null;
  durationMaxMs: number | null;
}

export interface OperatorErrorGroup {
  appId: string;
  route: string;
  message: string;
  count: number;
  lastSeen: string;
  location: string | null;
}

export interface OperatorGpuHeadroom {
  name: string;
  freeMiB: number;
  totalMiB: number;
}

export interface OperatorHealthSnapshot {
  hub: 'up' | 'down';
  database: 'up' | 'down';
  rodrigo: 'up' | 'down' | 'unconfigured';
  ocrWorker: 'up' | 'down';
  llm: 'paused' | 'available' | 'unavailable' | 'unknown';
  gpu: OperatorGpuHeadroom | null;
  checkedAt: string;
  stale: boolean;
}

/** Platform-operator read model. Counts, names, and plan labels only. */
export interface OperatorDashboardSnapshot {
  health: OperatorHealthSnapshot;
  activity: OperatorActivityItem[];
  usage: {
    hours: OperatorUsagePoint[];
    days: OperatorUsagePoint[];
  };
  appLoad: OperatorAppLoad[];
  errors: OperatorErrorGroup[];
  workspaces: OperatorWorkspaceRow[];
  notices: OperatorNoticeRecord[];
  droppedSamples: number;
}
