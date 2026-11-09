import type {
  PartitionItem,
  ScopedLoadItem,
  UserLoadGroup,
  UserLoadPartition,
  UserLoadWorkspace,
} from '@sorye/types';

function byWorkspaceName(a: UserLoadWorkspace, b: UserLoadWorkspace): number {
  const name = a.name.localeCompare(b.name);
  return name !== 0 ? name : a.id.localeCompare(b.id);
}

/**
 * Group items by the workspace kind the user is allowed to read.
 * Items whose workspace is not in `memberships` are dropped.
 * `audienceIds` drops a row the user was not invited to.
 */
export function partitionUserLoad<T>(
  userId: string,
  memberships: readonly UserLoadWorkspace[],
  items: readonly PartitionItem<T>[],
): UserLoadPartition<T> {
  const allowed = new Map<string, UserLoadWorkspace>();
  for (const membership of memberships) {
    if (membership.kind !== 'personal' && membership.kind !== 'team') continue;
    if (!membership.id || allowed.has(membership.id)) continue;
    allowed.set(membership.id, membership);
  }

  const grouped = new Map<string, ScopedLoadItem<T>[]>();
  for (const membership of allowed.values()) grouped.set(membership.id, []);

  for (const item of items) {
    const membership = allowed.get(item.workspaceId);
    if (!membership) continue;
    if (item.audienceIds && !item.audienceIds.includes(userId)) continue;
    grouped.get(membership.id)?.push({
      workspaceId: membership.id,
      workspaceName: membership.name,
      workspaceKind: membership.kind,
      value: item.value,
    });
  }

  const toGroup = (membership: UserLoadWorkspace): UserLoadGroup<T> => ({
    workspace: membership,
    items: grouped.get(membership.id) ?? [],
  });

  const personal = [...allowed.values()]
    .filter((membership) => membership.kind === 'personal')
    .sort(byWorkspaceName)
    .map(toGroup);
  const work = [...allowed.values()]
    .filter((membership) => membership.kind === 'team')
    .sort(byWorkspaceName)
    .map(toGroup);

  return { personal, work };
}

/**
 * Stable concatenation a future UI could render as one list.
 * Personal first, then each team workspace by name. Not sent to list UIs.
 */
export function mergeUserLoad<T>(partition: UserLoadPartition<T>): ScopedLoadItem<T>[] {
  const personal = [...partition.personal].sort((a, b) => byWorkspaceName(a.workspace, b.workspace));
  const work = [...partition.work].sort((a, b) => byWorkspaceName(a.workspace, b.workspace));
  return [
    ...personal.flatMap((group) => group.items),
    ...work.flatMap((group) => group.items),
  ];
}

/**
 * Public channels with an empty member list are the workspace defaults
 * (`general`, `random`, `events`). There is no separate invite table, so
 * workspace membership is the invite. A non-empty member list is explicit.
 */
/**
 * Drop personal rows the viewer's personal package does not include.
 * `false` omits the Personal section. A predicate removes only those rows.
 * Work groups are unchanged.
 */
export function applyPersonalPackageGate<T>(
  partition: UserLoadPartition<T>,
  allowsPersonal: boolean | ((value: T) => boolean),
  options?: { keepEmpty?: boolean },
): UserLoadPartition<T> {
  if (allowsPersonal === true) return partition;
  if (allowsPersonal === false) return { personal: [], work: partition.work };
  const personal = partition.personal.flatMap((group) => {
    const items = group.items.filter((item) => allowsPersonal(item.value));
    if (items.length === 0 && group.items.length > 0 && !options?.keepEmpty) {
      return [];
    }
    return [{ ...group, items }];
  });
  return { personal, work: partition.work };
}

export function messengerAudienceIds(channel: {
  kind: string;
  memberIds: readonly string[];
}): readonly string[] | undefined {
  if (channel.kind === 'dm' || channel.memberIds.length > 0) return channel.memberIds;
  return undefined;
}
