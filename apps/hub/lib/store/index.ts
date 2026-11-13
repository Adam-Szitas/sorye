/**
 * Identity facade. Users, workspaces, membership, plan and enabled apps are owned by
 * Rodrigo (alignment slice 1); Hub keeps no identity store and has no fallback.
 * The workspace storage summary is still attached from Hub until the storage slice moves.
 */
import { setIdentitySessionDecorator } from '@/lib/rodrigo/identity-client';
import { getWorkspaceStoragePublic, getWorkspaceStorageRecord } from './workspace-storage';

setIdentitySessionDecorator(async (session) => ({
  ...session,
  workspace: { ...session.workspace, storage: getWorkspaceStoragePublic(await getWorkspaceStorageRecord(session.workspace.id)) },
}));

export {
  getOrCreateUser,
  getUserByEmail,
  getHubSession,
  getHubSessionForWorkspace,
  updateWorkspace,
  switchActiveWorkspace,
  createTeamWorkspace,
  adminAssignSubscription,
  assignWorkspacePlan,
  setWorkspaceTier,
  operatorWorkspaceExists,
  listOperatorWorkspaces,
  listUsers,
  getWorkspaceMembers,
  resolveLoginSession,
} from '@/lib/rodrigo/identity-client';
