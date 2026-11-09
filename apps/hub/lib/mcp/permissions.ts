import {
  APP_CATALOG,
  withAlwaysAvailableAppIds,
  type HubSession,
  type McpToolDescriptor,
} from '@sorye/types';
import { isPlatformAdmin } from '@/lib/platform-admin';

export class McpPermissionError extends Error {
  constructor(
    message: string,
    readonly code: 'WORKSPACE_DENIED' | 'APP_NOT_ENABLED' | 'ADMIN_REQUIRED' = 'APP_NOT_ENABLED',
    readonly requiredAppId?: string,
  ) {
    super(message);
  }
}

export function isWorkspaceMember(session: HubSession): boolean {
  const { user, workspace } = session;
  return (
    workspace.ownerId === user.id ||
    workspace.memberIds.includes(user.id)
  );
}

export function allowedAppIdsForSession(session: HubSession): Set<string> {
  if (!isWorkspaceMember(session)) return new Set();
  const effective = withAlwaysAvailableAppIds(
    APP_CATALOG,
    session.workspace.selectedAppIds,
  );
  const adminIds = isPlatformAdmin(session.user)
    ? APP_CATALOG.filter((app) => app.adminOnly).map((app) => app.id)
    : [];
  return new Set(['hub', ...effective, ...adminIds]);
}

export function assertMcpToolPermission(
  session: HubSession,
  tool: Pick<McpToolDescriptor, 'name' | 'appId' | 'requiresAdmin'>,
): void {
  if (!isWorkspaceMember(session)) {
    throw new McpPermissionError(
      'You do not have access to this workspace.',
      'WORKSPACE_DENIED',
    );
  }
  if (tool.requiresAdmin && !isPlatformAdmin(session.user)) {
    throw new McpPermissionError(
      `The tool "${tool.name}" requires platform administrator permissions.`,
      'ADMIN_REQUIRED',
    );
  }
  const allowedApps = allowedAppIdsForSession(session);
  if (!allowedApps.has(tool.appId)) {
    const entry = APP_CATALOG.find((app) => app.id === tool.appId);
    const label = entry?.name ?? tool.appId;
    throw new McpPermissionError(
      `The "${label}" app is not enabled in this workspace. Enable ${label} in Manage apps to use "${tool.name}".`,
      'APP_NOT_ENABLED',
      tool.appId,
    );
  }
}

export function filterPermittedMcpTools<T extends Pick<McpToolDescriptor, 'name' | 'appId' | 'requiresAdmin'>>(
  session: HubSession,
  tools: readonly T[],
): T[] {
  if (!isWorkspaceMember(session)) return [];
  const allowedApps = allowedAppIdsForSession(session);
  const admin = isPlatformAdmin(session.user);
  return tools.filter((tool) => {
    if (tool.requiresAdmin && !admin) return false;
    return allowedApps.has(tool.appId);
  });
}
