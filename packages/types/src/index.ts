export * from './subscription';
export * from './workspace';
export * from './apps';
export * from './canvas';
export * from './embed';
export * from './messenger';
export * from './storage';
export * from './events';
export * from './ocr';

import type { SubscriptionTierId } from './subscription';
import type { UserWorkspace } from './workspace';

/** Demo fallback — real sessions come from the API after Google sign-in */
export const DEFAULT_WORKSPACE: UserWorkspace = {
  userId: 'demo-user',
  displayName: 'Alex Morgan',
  email: 'alex@sorye.dev',
  subscriptionId: 'starter',
  selectedAppIds: ['dashboard'],
  connectedApps: [],
  updatedAt: new Date().toISOString(),
};

export interface HubState {
  workspace: UserWorkspace;
  catalog: import('./apps').AppCatalogEntry[];
  plans: import('./subscription').SubscriptionPlan[];
}
