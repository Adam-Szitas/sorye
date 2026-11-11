import { getDb } from '@sorye/db';
import * as schema from '@sorye/db/schema';
import {
  SUBSCRIPTION_PLANS,
  canCreateTeamWorkspace,
  getPlanById,
  trimWorkspaceToPlanLimits,
  type ConnectedApp,
  type HubSession,
  type HubUser,
  type SubscriptionTierId,
  type Workspace,
  type WorkspaceSummary,
} from '@sorye/types';
import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { assignPlanInWorkspaceMap, type OperatorWorkspaceRecord } from '@/lib/operator/plan-record';
import { toPublicStorage } from '@/lib/workspace-storage-util';

async function loadConnections(workspaceId: string): Promise<ConnectedApp[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.connectedApps)
    .where(eq(schema.connectedApps.workspaceId, workspaceId));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    apiKeyHint: row.apiKeyHint,
    status: row.status,
    connectedAt: row.connectedAt.toISOString(),
    scopes: row.scopes,
  }));
}

async function loadWorkspaceRow(
  workspaceId: string,
  memberIds: string[],
): Promise<Workspace | null> {
  const db = getDb();
  // Two independent reads keyed by the same workspace id: one wait, not two.
  const [[row], connectedApps] = await Promise.all([
    db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1),
    loadConnections(workspaceId),
  ]);

  if (!row) return null;

  const storage =
    row.storageDriver === 'default' || !row.databaseUrlEncrypted
      ? toPublicStorage(undefined)
      : toPublicStorage({
          driver: 'postgres',
          status:
            row.storageStatus === 'connected' || row.storageStatus === 'error'
              ? row.storageStatus
              : 'connected',
          hostHint: row.storageHostHint ?? undefined,
          databaseHint: row.storageDatabaseHint ?? undefined,
          updatedAt: row.storageUpdatedAt?.toISOString(),
          lastError: row.storageLastError ?? undefined,
          databaseUrlEncrypted: row.databaseUrlEncrypted,
        });

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    ownerId: row.ownerId,
    memberIds,
    subscriptionId: row.subscriptionId,
    subscriptionSource: row.subscriptionSource,
    stripeCustomerId: row.stripeCustomerId ?? undefined,
    stripeSubscriptionId: row.stripeSubscriptionId ?? undefined,
    selectedAppIds: row.selectedAppIds,
    connectedApps,
    storage,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Team workspaces the user is a member of, read from the membership table. */
async function loadTeamWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  const db = getDb();
  return db
    .select({
      id: schema.workspaces.id,
      kind: schema.workspaces.kind,
      name: schema.workspaces.name,
    })
    .from(schema.workspaceMembers)
    .innerJoin(
      schema.workspaces,
      eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
    )
    .where(
      and(
        eq(schema.workspaceMembers.userId, userId),
        eq(schema.workspaces.kind, 'team'),
      ),
    );
}

async function loadTeamWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await loadTeamWorkspaces(userId);
  return rows.map((row) => row.id);
}

async function loadWorkspaceSummary(workspaceId: string): Promise<WorkspaceSummary | undefined> {
  const [row] = await getDb()
    .select({
      id: schema.workspaces.id,
      kind: schema.workspaces.kind,
      name: schema.workspaces.name,
    })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return row;
}

function hubUserFromRow(
  userRow: typeof schema.users.$inferSelect,
  teams: WorkspaceSummary[],
): HubUser {
  return {
    id: userRow.id,
    email: userRow.email,
    displayName: userRow.displayName,
    image: userRow.image ?? undefined,
    personalWorkspaceId: userRow.personalWorkspaceId,
    teamWorkspaceIds: teams.map((team) => team.id),
    activeWorkspaceId: userRow.activeWorkspaceId,
    isAdmin: userRow.isAdmin,
  };
}

/** Personal workspace first, then team memberships, as the session has always listed them. */
function workspaceSummaries(
  personal: WorkspaceSummary | undefined,
  teams: WorkspaceSummary[],
): WorkspaceSummary[] {
  return personal ? [personal, ...teams] : [...teams];
}

async function loadMemberIds(workspaceId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ userId: schema.workspaceMembers.userId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId));

  return rows.map((row) => row.userId);
}

async function buildHubUser(userRow: typeof schema.users.$inferSelect): Promise<HubUser> {
  return hubUserFromRow(userRow, await loadTeamWorkspaces(userRow.id));
}

/**
 * The session reads do not depend on one another, so they run as one concurrent
 * wave. Run in sequence they cost one database round trip each, plus one per
 * workspace, on every authenticated request.
 */
async function buildSession(
  userRow: typeof schema.users.$inferSelect,
): Promise<HubSession | null> {
  const [teams, personal, memberIds, workspace] = await Promise.all([
    loadTeamWorkspaces(userRow.id),
    loadWorkspaceSummary(userRow.personalWorkspaceId),
    loadMemberIds(userRow.activeWorkspaceId),
    loadWorkspaceRow(userRow.activeWorkspaceId, []),
  ]);
  if (!workspace) return null;

  return {
    user: hubUserFromRow(userRow, teams),
    workspace: { ...workspace, memberIds },
    workspaces: workspaceSummaries(personal, teams),
  };
}

export async function getOrCreateUser(input: {
  id: string;
  email: string;
  displayName: string;
  image?: string;
  isAdmin: boolean;
}): Promise<HubUser> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, input.id))
    .limit(1);

  if (existing) {
    await db
      .update(schema.users)
      .set({
        displayName: input.displayName,
        image: input.image,
        isAdmin: input.isAdmin,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, input.id));

    return buildHubUser({
      ...existing,
      displayName: input.displayName,
      image: input.image ?? existing.image,
      isAdmin: input.isAdmin,
    });
  }

  const workspaceId = `ws-personal-${randomUUID().slice(0, 8)}`;

  await db.insert(schema.users).values({
    id: input.id,
    email: input.email,
    displayName: input.displayName,
    image: input.image,
    personalWorkspaceId: workspaceId,
    activeWorkspaceId: workspaceId,
    isAdmin: input.isAdmin,
  });

  await db.insert(schema.workspaces).values({
    id: workspaceId,
    kind: 'personal',
    name: 'Personal',
    ownerId: input.id,
    subscriptionId: 'free',
    subscriptionSource: 'admin',
    selectedAppIds: ['dashboard'],
  });

  await db.insert(schema.workspaceMembers).values({
    workspaceId,
    userId: input.id,
    role: 'owner',
  });

  const [created] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, input.id))
    .limit(1);

  return buildHubUser(created);
}

export async function getUserByEmail(email: string): Promise<HubUser | null> {
  const db = getDb();
  const [userRow] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = lower(${email})`)
    .limit(1);

  return userRow ? buildHubUser(userRow) : null;
}

export async function getHubSession(userId: string): Promise<HubSession | null> {
  const db = getDb();
  const [userRow] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!userRow) return null;
  return buildSession(userRow);
}

export async function getHubSessionForWorkspace(
  userId: string,
  workspaceId: string,
): Promise<HubSession | null> {
  const db = getDb();
  // The user and the membership list are read first, together. Nothing about
  // the workspace is loaded until membership has been confirmed.
  const [[userRow], memberIds] = await Promise.all([
    db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1),
    loadMemberIds(workspaceId),
  ]);

  if (!userRow) return null;
  if (!memberIds.includes(userId)) return null;

  const [workspace, teams, personal] = await Promise.all([
    loadWorkspaceRow(workspaceId, memberIds),
    loadTeamWorkspaces(userRow.id),
    loadWorkspaceSummary(userRow.personalWorkspaceId),
  ]);
  if (!workspace) return null;

  return {
    user: { ...hubUserFromRow(userRow, teams), activeWorkspaceId: workspaceId },
    workspace,
    workspaces: workspaceSummaries(personal, teams),
  };
}

export async function updateWorkspace(
  userId: string,
  workspaceId: string,
  patch: Partial<
    Pick<Workspace, 'selectedAppIds' | 'connectedApps' | 'name' | 'memberIds'>
  >,
): Promise<HubSession | null> {
  const db = getDb();
  const members = await loadMemberIds(workspaceId);
  if (!members.includes(userId)) return null;

  if (patch.name !== undefined || patch.selectedAppIds !== undefined) {
    await db
      .update(schema.workspaces)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.selectedAppIds !== undefined
          ? { selectedAppIds: patch.selectedAppIds }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, workspaceId));
  }

  if (patch.connectedApps !== undefined) {
    await db
      .delete(schema.connectedApps)
      .where(eq(schema.connectedApps.workspaceId, workspaceId));

    if (patch.connectedApps.length > 0) {
      await db.insert(schema.connectedApps).values(
        patch.connectedApps.map((conn) => ({
          id: conn.id,
          workspaceId,
          name: conn.name,
          endpoint: conn.endpoint,
          apiKeyHint: conn.apiKeyHint,
          status: conn.status,
          scopes: conn.scopes,
          connectedAt: new Date(conn.connectedAt),
        })),
      );
    }
  }

  return getHubSession(userId);
}

export async function switchActiveWorkspace(
  userId: string,
  workspaceId: string,
): Promise<HubSession | null> {
  const db = getDb();
  const [userRow] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!userRow) return null;

  const teamIds = await loadTeamWorkspaceIds(userId);
  const allowed = [userRow.personalWorkspaceId, ...teamIds];
  if (!allowed.includes(workspaceId)) return null;

  await db
    .update(schema.users)
    .set({ activeWorkspaceId: workspaceId, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));

  return getHubSession(userId);
}

export async function createTeamWorkspace(
  userId: string,
  name: string,
): Promise<HubSession | null> {
  const db = getDb();
  const [userRow] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!userRow) return null;

  const teamIds = await loadTeamWorkspaceIds(userId);
  const [personal] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, userRow.personalWorkspaceId))
    .limit(1);

  if (!personal) return null;

  const plan = getPlanById(SUBSCRIPTION_PLANS, personal.subscriptionId);
  if (!canCreateTeamWorkspace(plan, teamIds.length)) return null;

  const teamId = `ws-team-${randomUUID().slice(0, 8)}`;

  await db.insert(schema.workspaces).values({
    id: teamId,
    kind: 'team',
    name,
    ownerId: userId,
    subscriptionId: personal.subscriptionId,
    subscriptionSource: personal.subscriptionSource,
    selectedAppIds: personal.selectedAppIds,
  });

  await db.insert(schema.workspaceMembers).values({
    workspaceId: teamId,
    userId,
    role: 'owner',
  });

  await db
    .update(schema.users)
    .set({ activeWorkspaceId: teamId, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));

  return getHubSession(userId);
}

export async function adminAssignSubscription(
  email: string,
  subscriptionId: SubscriptionTierId,
): Promise<Workspace | null> {
  const db = getDb();
  const [userRow] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = lower(${email})`)
    .limit(1);

  if (!userRow) return null;

  const teamIds = await loadTeamWorkspaceIds(userRow.id);
  const workspaceIds = [userRow.personalWorkspaceId, ...teamIds];
  const plan = getPlanById(SUBSCRIPTION_PLANS, subscriptionId);

  for (const workspaceId of workspaceIds) {
    const memberIds = await loadMemberIds(workspaceId);
    const current = await loadWorkspaceRow(workspaceId, memberIds);
    if (!current) continue;

    const trimmed = trimWorkspaceToPlanLimits(
      {
        ...current,
        subscriptionId,
        subscriptionSource: 'admin',
        updatedAt: new Date().toISOString(),
      },
      plan.maxApps,
      plan.maxConnections,
    );

    await db
      .update(schema.workspaces)
      .set({
        subscriptionId: trimmed.subscriptionId,
        subscriptionSource: trimmed.subscriptionSource,
        selectedAppIds: trimmed.selectedAppIds,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, workspaceId));

    if (trimmed.connectedApps.length !== current.connectedApps.length) {
      await updateWorkspace(userRow.id, workspaceId, {
        connectedApps: trimmed.connectedApps,
      });
    }
  }

  const memberIds = await loadMemberIds(userRow.personalWorkspaceId);
  return loadWorkspaceRow(userRow.personalWorkspaceId, memberIds);
}

export async function assignWorkspacePlan(
  workspaceId: string,
  subscriptionId: SubscriptionTierId,
): Promise<Workspace | null> {
  const memberIds = await loadMemberIds(workspaceId);
  const current = await loadWorkspaceRow(workspaceId, memberIds);
  if (!current) return null;
  const map: Record<string, Workspace> = { [current.id]: current };
  const trimmed = assignPlanInWorkspaceMap(map, workspaceId, subscriptionId);
  if (!trimmed) return null;
  const db = getDb();
  await db
    .update(schema.workspaces)
    .set({
      subscriptionId: trimmed.subscriptionId,
      subscriptionSource: 'admin',
      selectedAppIds: trimmed.selectedAppIds,
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, workspaceId));
  if (trimmed.connectedApps.length !== current.connectedApps.length) {
    await updateWorkspace(current.ownerId, workspaceId, {
      connectedApps: trimmed.connectedApps,
    });
  }
  return trimmed;
}

/** Set the tier that applies to a workspace without removing anything; see the JSON store. */
export async function setWorkspaceTier(
  workspaceId: string,
  subscriptionId: SubscriptionTierId,
): Promise<Workspace | null> {
  const updated = await getDb()
    .update(schema.workspaces)
    .set({ subscriptionId, updatedAt: new Date() })
    .where(eq(schema.workspaces.id, workspaceId))
    .returning({ id: schema.workspaces.id });
  if (updated.length === 0) return null;
  const memberIds = await loadMemberIds(workspaceId);
  return loadWorkspaceRow(workspaceId, memberIds);
}

export async function operatorWorkspaceExists(workspaceId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return Boolean(row);
}

export async function listOperatorWorkspaces(): Promise<OperatorWorkspaceRecord[]> {
  const rows = await getDb()
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      kind: schema.workspaces.kind,
      subscriptionId: schema.workspaces.subscriptionId,
      selectedAppIds: schema.workspaces.selectedAppIds,
    })
    .from(schema.workspaces);
  return rows;
}

export async function listUsers(): Promise<
  Array<{ email: string; subscriptionId: SubscriptionTierId; isAdmin: boolean }>
> {
  const db = getDb();
  const users = await db.select().from(schema.users);
  const results = [];

  for (const user of users) {
    const [ws] = await db
      .select({ subscriptionId: schema.workspaces.subscriptionId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, user.personalWorkspaceId))
      .limit(1);

    results.push({
      email: user.email,
      subscriptionId: ws?.subscriptionId ?? 'free',
      isAdmin: user.isAdmin,
    });
  }

  return results;
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
  const db = getDb();
  const memberIds = await loadMemberIds(workspaceId);
  if (memberIds.length === 0) return [];

  const rows = await db.select().from(schema.users);
  return rows
    .filter((u) => memberIds.includes(u.id))
    .map((u) => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      image: u.image ?? undefined,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
