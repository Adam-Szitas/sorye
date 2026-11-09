/** Personal vs team list split. The UI receives only a partition. */

export type UserLoadKind = 'personal' | 'team';

export interface UserLoadWorkspace {
  id: string;
  name: string;
  kind: UserLoadKind;
}

export interface ScopedLoadItem<T> {
  workspaceId: string;
  workspaceName: string;
  workspaceKind: UserLoadKind;
  value: T;
}

export interface UserLoadGroup<T> {
  workspace: UserLoadWorkspace;
  items: ScopedLoadItem<T>[];
}

/** `personal` and `work` are omitted (empty arrays) when the user has no workspace of that kind. */
export interface UserLoadPartition<T> {
  personal: UserLoadGroup<T>[];
  work: UserLoadGroup<T>[];
}

export interface PartitionItem<T> {
  workspaceId: string;
  value: T;
  /**
   * When set, the user must be in this list (joined or invited).
   * Omit it when workspace membership is the whole audience.
   */
  audienceIds?: readonly string[];
}
