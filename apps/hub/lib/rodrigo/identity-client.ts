import { z } from 'zod';
import {
  RODRIGO_PLATFORM_WORKSPACE_ID,
  RODRIGO_SERVICE_HUB_ACTOR,
  type HubSession,
  type HubUser,
  type SubscriptionTierId,
  type Workspace,
  type WorkspaceKind,
} from '@sorye/types';
import { onRodrigoChange, onRodrigoChangeReset, rodrigoChangesHealthy } from './changes';
import { RodrigoResponseError, type RodrigoContext } from './service-client';
import { readJson, signedFetch } from './transport';

/**
 * Identity is owned by Rodrigo (alignment slice 1): users, workspaces, membership, plan and
 * enabled apps. Hub verifies the browser login, signs its subject on the reserved
 * `rodrigo-identity` grant, and caches the resolved session briefly. The cache is dropped
 * by Rodrigo's identity change rows and bypassed while the change stream is down.
 * There is no Hub fallback: if Rodrigo cannot answer, the request fails.
 */
export const RODRIGO_IDENTITY_WORKSPACE_ID = 'rodrigo-identity';
const SESSION_TTL_MS = 15_000;

const userSchema = z.object({
  id: z.string().min(1).max(128), email: z.string().max(254), displayName: z.string().max(120), image: z.string().max(2048).optional(),
  personalWorkspaceId: z.string(), teamWorkspaceIds: z.array(z.string()), activeWorkspaceId: z.string(), isAdmin: z.boolean(),
}).strict();
const workspaceSchema = z.object({
  id: z.string(), kind: z.enum(['personal', 'team']), name: z.string(), ownerId: z.string(), memberIds: z.array(z.string()),
  subscriptionId: z.enum(['free', 'starter', 'pro', 'enterprise']), subscriptionSource: z.string(),
  stripeCustomerId: z.string().optional(), stripeSubscriptionId: z.string().optional(),
  selectedAppIds: z.array(z.string()).max(64), connectedApps: z.array(z.record(z.unknown())).max(64),
  revision: z.number().int().positive(), updatedAt: z.string(),
}).strict();
const sessionSchema = z.object({
  contractVersion: z.literal('2'), user: userSchema, workspace: workspaceSchema,
  workspaces: z.array(z.object({ id: z.string(), kind: z.enum(['personal', 'team']), name: z.string() }).strict()),
}).strict();
type WireSession = z.infer<typeof sessionSchema>;

export interface LoginProfile { id: string; email: string; displayName: string; image?: string; isAdmin: boolean }

/** Attaches Hub-side extras (for example the storage summary) to a resolved session. */
type SessionDecorator = (session: HubSession) => Promise<HubSession>;
let decorate: SessionDecorator = async (session) => session;
export function setIdentitySessionDecorator(fn: SessionDecorator) { decorate = fn; }

function toSession(wire: WireSession): HubSession {
  const { contractVersion: _, ...rest } = wire;
  return rest as unknown as HubSession;
}

// ---- session cache ------------------------------------------------------------------

interface CacheState { entries: Map<string, { session: HubSession; expires: number; generation: number }>; generations: Map<string, number>; wired: boolean }
const cacheKey = Symbol.for('sorye.rodrigo.identityCache');
const g = globalThis as unknown as Record<symbol, CacheState | undefined>;
function cache(): CacheState {
  g[cacheKey] ??= { entries: new Map(), generations: new Map(), wired: false };
  const c = g[cacheKey]!;
  if (!c.wired) {
    c.wired = true;
    onRodrigoChange((change) => {
      if (change.appId === 'identity' && change.resourceType === 'session') forgetUser(change.resourceId);
    });
    onRodrigoChangeReset(() => { c.entries.clear(); c.generations.clear(); });
  }
  return c;
}
function forgetUser(userId: string) {
  const c = cache();
  c.generations.set(userId, (c.generations.get(userId) ?? 0) + 1);
  for (const key of c.entries.keys()) if (key.startsWith(`${userId}\u0000`)) c.entries.delete(key);
}
function cached(userId: string, workspace: string): HubSession | undefined {
  if (!rodrigoChangesHealthy()) return undefined;
  const entry = cache().entries.get(`${userId}\u0000${workspace}`);
  return entry && entry.expires > Date.now() ? entry.session : undefined;
}
function remember(userId: string, workspace: string, session: HubSession, generation: number) {
  const c = cache();
  if (!rodrigoChangesHealthy() || (c.generations.get(userId) ?? 0) !== generation) return;
  if (c.entries.size > 20_000) c.entries.clear();
  c.entries.set(`${userId}\u0000${workspace}`, { session, expires: Date.now() + SESSION_TTL_MS, generation });
}
export function identityCacheSize() { return cache().entries.size; }

// ---- transport ----------------------------------------------------------------------

const asUser = (userId: string): RodrigoContext => ({ userId, workspaceId: RODRIGO_IDENTITY_WORKSPACE_ID });
const asHub: RodrigoContext = { userId: RODRIGO_SERVICE_HUB_ACTOR, workspaceId: RODRIGO_PLATFORM_WORKSPACE_ID };

async function call<T>(context: RodrigoContext, method: string, path: string, scope: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const response = await signedFetch({ context, method, path, scope, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return readJson(response, schema, 262144);
}
const refused = (error: unknown, ...codes: string[]) => error instanceof RodrigoResponseError && codes.includes(error.code);

// ---- session resolution -------------------------------------------------------------

/** Session for a verified login. Creates the user on first sign-in; one read when cached. */
export async function resolveLoginSession(login: LoginProfile): Promise<HubSession> {
  const hit = cached(login.id, 'active');
  if (hit && sameProfile(hit.user, login)) return hit;
  const generation = cache().generations.get(login.id) ?? 0;
  let wire: WireSession | null = null;
  try {
    wire = await call(asUser(login.id), 'GET', '/v2/identity/session/active', 'identity:read', sessionSchema);
  } catch (error) {
    if (!refused(error, 'user_not_found')) throw error;
  }
  if (!wire || !sameProfile(wire.user, login)) {
    wire = await call(asUser(login.id), 'PUT', '/v2/identity/profile', 'identity:write', sessionSchema,
      { email: login.email, displayName: login.displayName, image: login.image ?? null, isAdmin: login.isAdmin });
    forgetUser(login.id);
    const session = await decorate(toSession(wire));
    remember(login.id, 'active', session, cache().generations.get(login.id) ?? 0);
    return session;
  }
  const session = await decorate(toSession(wire));
  remember(login.id, 'active', session, generation);
  return session;
}
function sameProfile(user: HubUser, login: LoginProfile) {
  return user.email === login.email && user.displayName === login.displayName && (user.image ?? undefined) === (login.image ?? undefined) && user.isAdmin === login.isAdmin;
}

// ---- the lib/store facade -----------------------------------------------------------

export async function getOrCreateUser(input: LoginProfile): Promise<HubUser> {
  return (await resolveLoginSession(input)).user;
}

export async function getUserByEmail(email: string): Promise<HubUser | null> {
  try {
    const hex = Buffer.from(email, 'utf8').toString('hex');
    const result = await call(asHub, 'GET', `/v2/platform/identity/users/by-email/${hex}`, 'platform:identity:read', z.object({ contractVersion: z.literal('2'), user: userSchema }).strict());
    return result.user as HubUser;
  } catch (error) {
    if (refused(error, 'user_not_found')) return null;
    throw error;
  }
}

async function sessionFor(userId: string, workspace: string): Promise<HubSession | null> {
  const hit = cached(userId, workspace);
  if (hit) return hit;
  const generation = cache().generations.get(userId) ?? 0;
  try {
    const wire = await call(asUser(userId), 'GET', `/v2/identity/session/${encodeURIComponent(workspace)}`, 'identity:read', sessionSchema);
    const session = await decorate(toSession(wire));
    remember(userId, workspace, session, generation);
    return session;
  } catch (error) {
    if (refused(error, 'user_not_found', 'not_member', 'workspace_not_found', 'invalid_workspace')) return null;
    throw error;
  }
}

export const getHubSession = (userId: string) => sessionFor(userId, 'active');
export const getHubSessionForWorkspace = (userId: string, workspaceId: string) => sessionFor(userId, workspaceId);

async function write(userId: string, method: string, path: string, body: unknown): Promise<HubSession | null> {
  try {
    const wire = await call(asUser(userId), method, path, 'identity:write', sessionSchema, body);
    forgetUser(userId);
    return decorate(toSession(wire));
  } catch (error) {
    if (refused(error, 'user_not_found', 'not_member', 'workspace_not_found', 'plan_limit', 'revision_conflict', 'invalid_workspace',
      'invalid_workspace_patch', 'invalid_name', 'invalid_selected_apps', 'invalid_connected_apps')) return null;
    throw error;
  }
}

export async function updateWorkspace(
  userId: string,
  workspaceId: string,
  patch: Partial<Pick<Workspace, 'selectedAppIds' | 'connectedApps' | 'name' | 'memberIds'>>,
): Promise<HubSession | null> {
  // Membership is not editable through this path (memberIds is ignored, as before).
  const body: Record<string, unknown> = {};
  if (patch.selectedAppIds !== undefined) body.selectedAppIds = patch.selectedAppIds;
  if (patch.connectedApps !== undefined) body.connectedApps = patch.connectedApps;
  if (patch.name !== undefined) body.name = patch.name;
  const updated = await write(userId, 'PATCH', `/v2/identity/workspaces/${encodeURIComponent(workspaceId)}`, body);
  if (!updated) return null;
  // Previous behaviour: the result describes the user's active workspace.
  return getHubSession(userId);
}

export const switchActiveWorkspace = (userId: string, workspaceId: string) =>
  write(userId, 'POST', '/v2/identity/active-workspace', { workspaceId });

export const createTeamWorkspace = (userId: string, name: string) =>
  write(userId, 'POST', '/v2/identity/workspaces', { name });

const platformWorkspace = z.object({ contractVersion: z.literal('2'), workspace: workspaceSchema }).strict();

export async function adminAssignSubscription(email: string, subscriptionId: SubscriptionTierId): Promise<Workspace | null> {
  try {
    const workspace = (await call(asHub, 'POST', '/v2/platform/identity/users/plan', 'platform:identity:write', platformWorkspace, { email, subscriptionId })).workspace;
    // This replica sees its own write at once; others follow the change stream.
    workspace.memberIds.forEach(forgetUser);
    return workspace as unknown as Workspace;
  } catch (error) {
    if (refused(error, 'user_not_found')) return null;
    throw error;
  }
}

async function setPlan(workspaceId: string, subscriptionId: SubscriptionTierId, mode: 'assign' | 'tier'): Promise<Workspace | null> {
  try {
    const workspace = (await call(asHub, 'PUT', `/v2/platform/identity/workspaces/${encodeURIComponent(workspaceId)}/plan`, 'platform:identity:write', platformWorkspace, { subscriptionId, mode })).workspace;
    workspace.memberIds.forEach(forgetUser);
    return workspace as unknown as Workspace;
  } catch (error) {
    if (refused(error, 'workspace_not_found', 'invalid_plan')) return null;
    throw error;
  }
}
/** Administrator plan assignment: apps and connections over the new limits are removed. */
export const assignWorkspacePlan = (workspaceId: string, subscriptionId: SubscriptionTierId) => setPlan(workspaceId, subscriptionId, 'assign');
/** Billing tier change: nothing is removed; extras are reported as locked. */
export const setWorkspaceTier = (workspaceId: string, subscriptionId: SubscriptionTierId) => setPlan(workspaceId, subscriptionId, 'tier');

export async function operatorWorkspaceExists(workspaceId: string): Promise<boolean> {
  try {
    await call(asHub, 'GET', `/v2/platform/identity/workspaces/${encodeURIComponent(workspaceId)}`, 'platform:identity:read', platformWorkspace);
    return true;
  } catch (error) {
    if (refused(error, 'workspace_not_found', 'invalid_workspace')) return false;
    throw error;
  }
}

export interface OperatorWorkspaceRecord { id: string; name: string; kind: WorkspaceKind; subscriptionId: SubscriptionTierId; selectedAppIds: string[] }
export async function listOperatorWorkspaces(): Promise<OperatorWorkspaceRecord[]> {
  const result = await call(asHub, 'GET', '/v2/platform/identity/workspaces', 'platform:identity:read', z.object({
    contractVersion: z.literal('2'),
    workspaces: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['personal', 'team']), subscriptionId: z.enum(['free', 'starter', 'pro', 'enterprise']), selectedAppIds: z.array(z.string()) }).strict()),
  }).strict());
  return result.workspaces;
}

export async function listUsers(): Promise<Array<{ email: string; subscriptionId: SubscriptionTierId; isAdmin: boolean }>> {
  const result = await call(asHub, 'GET', '/v2/platform/identity/users', 'platform:identity:read', z.object({
    contractVersion: z.literal('2'),
    users: z.array(z.object({ email: z.string(), subscriptionId: z.enum(['free', 'starter', 'pro', 'enterprise']), isAdmin: z.boolean() }).strict()),
  }).strict(), undefined);
  return result.users;
}

export async function getWorkspaceMembers(workspaceId: string): Promise<Array<{ id: string; displayName: string; email: string; image?: string }>> {
  try {
    const result = await call(asHub, 'GET', `/v2/platform/identity/workspaces/${encodeURIComponent(workspaceId)}/members`, 'platform:identity:read', z.object({
      contractVersion: z.literal('2'),
      members: z.array(z.object({ id: z.string(), displayName: z.string(), email: z.string(), image: z.string().optional() }).strict()),
    }).strict());
    return result.members;
  } catch (error) {
    if (refused(error, 'invalid_workspace')) return [];
    throw error;
  }
}
