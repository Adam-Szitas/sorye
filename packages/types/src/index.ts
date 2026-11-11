export * from './subscription';
export * from './billing';
export * from './upload-storage';
export * from './running-cost';
export * from './rodrigo';
export * from './platform-config';
export * from './workspace';
export * from './apps';
export * from './canvas';
export * from './tasks';
export * from './notes';
export * from './calendar';
export * from './embed';
export * from './messenger';
export * from './storage';
export * from './events';
export * from './ocr';
export * from './ocr-ai';
export * from './handoff';
export * from './relay';
export * from './notifications';
export * from './studio';
export * from './reports';
export * from './operator';
export * from './analytics';
export * from './storefront';
export * from './site';
export * from './forms';
export * from './api-keys';
export * from './mail';
export * from './files';
export * from './cloud-storage';
export * from './llm';
export * from './user-load';

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
