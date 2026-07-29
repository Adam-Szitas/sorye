import type { HubSession } from '@sorye/types';

export function logHubInteraction(
  action: string,
  session: HubSession | null,
  extra?: Record<string, unknown>,
) {
  if (!session) {
    console.info('[Sorye:state]', action, { session: null, ...extra });
    return;
  }

  console.info('[Sorye:state]', action, {
    user: {
      id: session.user.id,
      email: session.user.email,
      isAdmin: session.user.isAdmin,
    },
    workspace: {
      id: session.workspace.id,
      kind: session.workspace.kind,
      name: session.workspace.name,
      subscriptionId: session.workspace.subscriptionId,
      subscriptionSource: session.workspace.subscriptionSource,
      selectedAppIds: session.workspace.selectedAppIds,
      connectionCount: session.workspace.connectedApps.length,
    },
    workspaces: session.workspaces.map((w) => ({
      id: w.id,
      kind: w.kind,
      name: w.name,
    })),
    ...extra,
  });
}
