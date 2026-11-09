import type { HubSession, PartitionItem, UserLoadPartition, UserLoadWorkspace } from '@sorye/types';
import { getHubSessionForWorkspace } from '@/lib/store';
import { viewerPersonalPackageAppIds } from './personal-package';
import { applyPersonalPackageGate, partitionUserLoad } from './user-load';

export function sessionWorkspace(session: HubSession): UserLoadWorkspace {
  return {
    id: session.workspace.id,
    name: session.workspace.name,
    kind: session.workspace.kind,
  };
}

export type PersonalLoadGate<T> =
  | { appId: string }
  | { itemAppId: (value: T) => string; personalApps: readonly string[] };

/** Server-derived memberships. A workspace id from the client is never accepted here. */
export async function memberScopes(session: HubSession): Promise<UserLoadWorkspace[]> {
  const scopes: UserLoadWorkspace[] = [];
  const seen = new Set<string>();
  for (const summary of session.workspaces) {
    if (!summary?.id || seen.has(summary.id)) continue;
    const checked = await getHubSessionForWorkspace(session.user.id, summary.id);
    if (!checked) continue;
    if (checked.user.id !== session.user.id) continue;
    if (checked.workspace.id !== summary.id) continue;
    if (!checked.workspace.memberIds.includes(session.user.id)) continue;
    if (checked.workspace.kind !== 'personal' && checked.workspace.kind !== 'team') continue;
    seen.add(checked.workspace.id);
    scopes.push({
      id: checked.workspace.id,
      name: checked.workspace.name,
      kind: checked.workspace.kind,
    });
  }
  return scopes;
}

/**
 * Read each member workspace. A failure outside the active workspace is skipped
 * so the active list still returns. The active workspace failure still throws.
 */
export async function readPartitionedLoad<T>(
  session: HubSession,
  read: (scope: UserLoadWorkspace) => Promise<PartitionItem<T>[]>,
  gate: PersonalLoadGate<T>,
): Promise<UserLoadPartition<T>> {
  const packageIds = new Set(await viewerPersonalPackageAppIds(session));
  const personalAllowed =
    'appId' in gate
      ? packageIds.has(gate.appId)
      : gate.personalApps.some((appId) => packageIds.has(appId));
  const memberships = await memberScopes(session);
  const readable = personalAllowed
    ? memberships
    : memberships.filter((scope) => scope.kind !== 'personal');
  const items: PartitionItem<T>[] = [];
  await Promise.all(
    readable.map(async (scope) => {
      try {
        const rows = await read(scope);
        for (const row of rows) {
          if (row.workspaceId !== scope.id) continue;
          items.push(row);
        }
      } catch (error) {
        if (scope.id === session.workspace.id) throw error;
      }
    }),
  );
  const partition = partitionUserLoad(session.user.id, readable, items);
  if ('appId' in gate) {
    return applyPersonalPackageGate(partition, packageIds.has(gate.appId));
  }
  return applyPersonalPackageGate(
    partition,
    (value) => packageIds.has(gate.itemAppId(value)),
    { keepEmpty: personalAllowed },
  );
}
