import {
  APP_CATALOG,
  withAlwaysAvailableAppIds,
  type HubSession,
} from '@sorye/types';
import { getHubSession, getHubSessionForWorkspace } from '@/lib/store';

/** Selected apps plus always-available catalog apps. */
export function packageIncludesApp(
  selectedAppIds: readonly string[],
  appId: string,
): boolean {
  return withAlwaysAvailableAppIds(APP_CATALOG, [...selectedAppIds]).includes(appId);
}

/**
 * Apps on the viewer's own personal workspace.
 * The workspace id comes from the server session, never from the client.
 */
export async function viewerPersonalPackageAppIds(
  session: HubSession,
): Promise<string[]> {
  const personalId = session.user.personalWorkspaceId;
  if (!personalId) return withAlwaysAvailableAppIds(APP_CATALOG, []);
  const personal =
    session.workspace.id === personalId && session.workspace.kind === 'personal'
      ? session
      : await getHubSessionForWorkspace(session.user.id, personalId);
  if (
    !personal ||
    personal.user.id !== session.user.id ||
    personal.workspace.id !== personalId ||
    personal.workspace.kind !== 'personal' ||
    !personal.workspace.memberIds.includes(session.user.id)
  ) {
    return withAlwaysAvailableAppIds(APP_CATALOG, []);
  }
  return withAlwaysAvailableAppIds(APP_CATALOG, personal.workspace.selectedAppIds);
}

export async function viewerPersonalPackageIncludes(
  session: HubSession,
  appId: string,
): Promise<boolean> {
  const ids = await viewerPersonalPackageAppIds(session);
  return ids.includes(appId);
}

/** The recipient's personal workspace subscription, loaded from the user store. */
export async function memberPersonalPackageIncludes(
  userId: string,
  appId: string,
): Promise<boolean> {
  const session = await getHubSession(userId);
  if (!session || session.user.id !== userId) return false;
  return viewerPersonalPackageIncludes(session, appId);
}
