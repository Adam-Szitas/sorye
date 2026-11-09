import type { ReactNode } from 'react';
import type { ScopedLoadItem, UserLoadGroup, UserLoadPartition } from '@sorye/types';

const SECTION_STYLE = `
.sorye-user-load-label { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; margin: 0.85rem 0 0.35rem; }
.sorye-user-load-team { font-size: 0.85rem; font-weight: 600; margin: 0.45rem 0 0.25rem; }
.sorye-user-load-empty { font-size: 0.8rem; opacity: 0.72; margin: 0 0 0.65rem; }
`;

/** Replace one workspace's rows with the in-memory active document. Does not combine sections. */
export function withActiveWorkspaceItems<T>(
  load: UserLoadPartition<T>,
  workspaceId: string,
  values: readonly T[],
): UserLoadPartition<T> {
  const apply = (group: UserLoadGroup<T>): UserLoadGroup<T> => {
    if (group.workspace.id !== workspaceId) return group;
    return {
      ...group,
      items: values.map((value) => ({
        workspaceId: group.workspace.id,
        workspaceName: group.workspace.name,
        workspaceKind: group.workspace.kind,
        value,
      })),
    };
  };
  return {
    personal: load.personal.map(apply),
    work: load.work.map(apply),
  };
}

export function UserLoadSections<T>({
  load,
  empty,
  renderItems,
  heading = 'h2',
}: {
  load: UserLoadPartition<T>;
  empty: string;
  renderItems: (items: ScopedLoadItem<T>[]) => ReactNode;
  heading?: 'h2' | 'h3';
}) {
  const Title = heading;
  const Sub = heading === 'h2' ? 'h3' : 'h4';
  const showPersonal = load.personal.length > 0;
  const showWork = load.work.length > 0;
  if (!showPersonal && !showWork) return null;

  const groups = (side: UserLoadGroup<T>[], nested: boolean) =>
    side.map((group) => (
      <div key={group.workspace.id}>
        {nested ? <Sub className="sorye-user-load-team">{group.workspace.name}</Sub> : null}
        {group.items.length === 0 ? (
          <p className="sorye-user-load-empty">{empty}</p>
        ) : (
          renderItems(group.items)
        )}
      </div>
    ));

  return (
    <div className="sorye-user-load">
      <style>{SECTION_STYLE}</style>
      {showPersonal ? (
        <section>
          <Title className="sorye-user-load-label">Personal</Title>
          {groups(load.personal, load.personal.length > 1)}
        </section>
      ) : null}
      {showWork ? (
        <section>
          <Title className="sorye-user-load-label">Work</Title>
          {groups(load.work, true)}
        </section>
      ) : null}
    </div>
  );
}
