import { getStoreDriver } from '@/lib/env';
import * as jsonStore from './json-store';
import * as postgresStore from './postgres-store';

function activeStore() {
  return getStoreDriver() === 'postgres' ? postgresStore : jsonStore;
}

export const getOrCreateUser = (...args: Parameters<typeof jsonStore.getOrCreateUser>) =>
  activeStore().getOrCreateUser(...args);

export const getUserByEmail = (...args: Parameters<typeof jsonStore.getUserByEmail>) =>
  activeStore().getUserByEmail(...args);

export const getHubSession = (...args: Parameters<typeof jsonStore.getHubSession>) =>
  activeStore().getHubSession(...args);

export const getHubSessionForWorkspace = (
  ...args: Parameters<typeof jsonStore.getHubSessionForWorkspace>
) => activeStore().getHubSessionForWorkspace(...args);

export const updateWorkspace = (...args: Parameters<typeof jsonStore.updateWorkspace>) =>
  activeStore().updateWorkspace(...args);

export const switchActiveWorkspace = (
  ...args: Parameters<typeof jsonStore.switchActiveWorkspace>
) => activeStore().switchActiveWorkspace(...args);

export const createTeamWorkspace = (
  ...args: Parameters<typeof jsonStore.createTeamWorkspace>
) => activeStore().createTeamWorkspace(...args);

export const adminAssignSubscription = (
  ...args: Parameters<typeof jsonStore.adminAssignSubscription>
) => activeStore().adminAssignSubscription(...args);

export const assignWorkspacePlan = (
  ...args: Parameters<typeof jsonStore.assignWorkspacePlan>
) => activeStore().assignWorkspacePlan(...args);

export const setWorkspaceTier = (
  ...args: Parameters<typeof jsonStore.setWorkspaceTier>
) => activeStore().setWorkspaceTier(...args);

export const operatorWorkspaceExists = (
  ...args: Parameters<typeof jsonStore.operatorWorkspaceExists>
) => activeStore().operatorWorkspaceExists(...args);

export const listOperatorWorkspaces = (
  ...args: Parameters<typeof jsonStore.listOperatorWorkspaces>
) => activeStore().listOperatorWorkspaces(...args);

export const listUsers = (...args: Parameters<typeof jsonStore.listUsers>) =>
  activeStore().listUsers(...args);

export const getWorkspaceMembers = (
  ...args: Parameters<typeof jsonStore.getWorkspaceMembers>
) => activeStore().getWorkspaceMembers(...args);
