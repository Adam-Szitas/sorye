import { randomUUID } from 'crypto';
import {
  SUBSCRIPTION_PLANS,
  canCreateTeamWorkspace,
  getPlanById,
  trimWorkspaceToPlanLimits,
  type HubSession,
  type HubUser,
  type SubscriptionTierId,
  type Workspace,
  type WorkspaceSummary,
} from '@sorye/types';
import { jsonDataFile } from './json-file';
import {
  getWorkspaceStoragePublic,
  getWorkspaceStorageRecord,
} from './workspace-storage';

interface StoreData {
  users: Record<string, HubUser>;
  workspaces: Record<string, Workspace>;
}

const storeFile = jsonDataFile<StoreData>('store.json', () => ({
  users: {},
  workspaces: {},
}));

const readStore = () => storeFile.read();

function createPersonalWorkspace(userId: string): Workspace {
  return {
    id: `ws-personal-${randomUUID().slice(0, 8)}`,
    kind: 'personal',
    name: 'Personal',
    ownerId: userId,
    memberIds: [userId],
    subscriptionId: 'free',
    subscriptionSource: 'admin',
    selectedAppIds: ['dashboard'],
    connectedApps: [],
    updatedAt: new Date().toISOString(),
  };
}

async function attachStorage(workspace: Workspace): Promise<Workspace> {
  const record = await getWorkspaceStorageRecord(workspace.id);
  return {
    ...workspace,
    storage: getWorkspaceStoragePublic(record),
  };
}

function toSummaries(
  user: HubUser,
  workspaces: Record<string, Workspace>,
): WorkspaceSummary[] {
  const ids = [
    user.personalWorkspaceId,
    ...user.teamWorkspaceIds.filter((id) => id !== user.personalWorkspaceId),
  ];

  return ids
    .map((id) => workspaces[id])
    .filter((ws): ws is Workspace => Boolean(ws))
    .map((ws) => ({ id: ws.id, kind: ws.kind, name: ws.name }));
}

export async function getOrCreateUser(input: {
  id: string;
  email: string;
  displayName: string;
  image?: string;
  isAdmin: boolean;
}): Promise<HubUser> {
  // Fast path: profile unchanged → no write. This runs on every request
  // via ensureHubUser(), so skipping the disk write matters.
  const snapshot = await readStore();
  const cached = snapshot.users[input.id];
  if (
    cached &&
    cached.displayName === input.displayName &&
    cached.image === input.image &&
    cached.isAdmin === input.isAdmin
  ) {
    return cached;
  }

  return storeFile.update((store) => {
    const existing = store.users[input.id];
    if (existing) {
      existing.displayName = input.displayName;
      existing.image = input.image;
      existing.isAdmin = input.isAdmin;
      return existing;
    }

    const workspace = createPersonalWorkspace(input.id);
    const user: HubUser = {
      id: input.id,
      email: input.email,
      displayName: input.displayName,
      image: input.image,
      personalWorkspaceId: workspace.id,
      teamWorkspaceIds: [],
      activeWorkspaceId: workspace.id,
      isAdmin: input.isAdmin,
    };

    store.workspaces[workspace.id] = workspace;
    store.users[input.id] = user;
    return user;
  });
}

export async function getUserByEmail(email: string): Promise<HubUser | null> {
  const store = await readStore();
  const needle = email.toLowerCase();
  return (
    Object.values(store.users).find(
      (user) => user.email.toLowerCase() === needle,
    ) ?? null
  );
}

export async function getHubSession(userId: string): Promise<HubSession | null> {
  const store = await readStore();
  const user = store.users[userId];
  if (!user) return null;

  const workspace = store.workspaces[user.activeWorkspaceId];
  if (!workspace) return null;

  return {
    user,
    workspace: await attachStorage(workspace),
    workspaces: toSummaries(user, store.workspaces),
  };
}

export async function getHubSessionForWorkspace(
  userId: string,
  workspaceId: string,
): Promise<HubSession | null> {
  const store = await readStore();
  const user = store.users[userId];
  if (!user) return null;

  const workspace = store.workspaces[workspaceId];
  if (!workspace || !workspace.memberIds.includes(userId)) return null;

  return {
    user: { ...user, activeWorkspaceId: workspaceId },
    workspace: await attachStorage(workspace),
    workspaces: toSummaries(user, store.workspaces),
  };
}

export async function updateWorkspace(
  userId: string,
  workspaceId: string,
  patch: Partial<
    Pick<Workspace, 'selectedAppIds' | 'connectedApps' | 'name' | 'memberIds'>
  >,
): Promise<HubSession | null> {
  const applied = await storeFile.update((store) => {
    const user = store.users[userId];
    if (!user) return false;

    const workspace = store.workspaces[workspaceId];
    if (!workspace || !workspace.memberIds.includes(userId)) return false;

    const safePatch: Partial<
      Pick<Workspace, 'selectedAppIds' | 'connectedApps' | 'name'>
    > = {};
    if (patch.selectedAppIds !== undefined) {
      safePatch.selectedAppIds = patch.selectedAppIds;
    }
    if (patch.connectedApps !== undefined) {
      safePatch.connectedApps = patch.connectedApps;
    }
    if (patch.name !== undefined) {
      safePatch.name = patch.name;
    }

    store.workspaces[workspaceId] = {
      ...workspace,
      ...safePatch,
      updatedAt: new Date().toISOString(),
    };
    return true;
  });

  if (!applied) return null;
  return getHubSession(userId);
}

export async function switchActiveWorkspace(
  userId: string,
  workspaceId: string,
): Promise<HubSession | null> {
  const applied = await storeFile.update((store) => {
    const user = store.users[userId];
    if (!user) return false;

    const allowed = [user.personalWorkspaceId, ...user.teamWorkspaceIds];
    if (!allowed.includes(workspaceId)) return false;

    user.activeWorkspaceId = workspaceId;
    return true;
  });

  if (!applied) return null;
  return getHubSession(userId);
}

export async function createTeamWorkspace(
  userId: string,
  name: string,
): Promise<HubSession | null> {
  const applied = await storeFile.update((store) => {
    const user = store.users[userId];
    if (!user) return false;

    const personal = store.workspaces[user.personalWorkspaceId];
    if (!personal) return false;

    const plan = getPlanById(SUBSCRIPTION_PLANS, personal.subscriptionId);
    if (!canCreateTeamWorkspace(plan, user.teamWorkspaceIds.length)) {
      return false;
    }

    const team: Workspace = {
      id: `ws-team-${randomUUID().slice(0, 8)}`,
      kind: 'team',
      name,
      ownerId: userId,
      memberIds: [userId],
      subscriptionId: personal.subscriptionId,
      subscriptionSource: personal.subscriptionSource,
      selectedAppIds: [...personal.selectedAppIds],
      connectedApps: [],
      updatedAt: new Date().toISOString(),
    };

    store.workspaces[team.id] = team;
    user.teamWorkspaceIds = [...user.teamWorkspaceIds, team.id];
    user.activeWorkspaceId = team.id;
    return true;
  });

  if (!applied) return null;
  return getHubSession(userId);
}

export async function adminAssignSubscription(
  email: string,
  subscriptionId: SubscriptionTierId,
): Promise<Workspace | null> {
  return storeFile.update((store) => {
    const user = Object.values(store.users).find(
      (u) => u.email.toLowerCase() === email.toLowerCase(),
    );
    if (!user) return null;

    const plan = getPlanById(SUBSCRIPTION_PLANS, subscriptionId);
    const workspaceIds = [user.personalWorkspaceId, ...user.teamWorkspaceIds];

    for (const id of workspaceIds) {
      const ws = store.workspaces[id];
      if (!ws) continue;
      store.workspaces[id] = trimWorkspaceToPlanLimits(
        {
          ...ws,
          subscriptionId,
          subscriptionSource: 'admin',
          updatedAt: new Date().toISOString(),
        },
        plan.maxApps,
        plan.maxConnections,
      );
    }

    return store.workspaces[user.personalWorkspaceId] ?? null;
  });
}

export async function listUsers(): Promise<
  Array<{ email: string; subscriptionId: SubscriptionTierId; isAdmin: boolean }>
> {
  const store = await readStore();
  return Object.values(store.users).map((user) => {
    const ws = store.workspaces[user.personalWorkspaceId];
    return {
      email: user.email,
      subscriptionId: ws?.subscriptionId ?? 'free',
      isAdmin: user.isAdmin,
    };
  });
}

export async function getWorkspaceMembers(
  workspaceId: string,
): Promise<
  Array<{
    id: string;
    displayName: string;
    email: string;
    image?: string;
  }>
> {
  const store = await readStore();
  const workspace = store.workspaces[workspaceId];
  if (!workspace) return [];
  return workspace.memberIds
    .map((id) => store.users[id])
    .filter((u): u is HubUser => Boolean(u))
    .map((u) => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      image: u.image,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
