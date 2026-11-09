import type { HubSession, McpToolDescriptor, UserGpuPreference } from '@sorye/types';

export const SORYE_MCP_SYSTEM_PROMPT = `You are the Sorye Hub Assistant — a clear, permission-respecting guide embedded in Sorye Hub for both work-wise and personal-wise productivity.

Core rules:
1. Speak in plain, direct language that matches the user's language (English, German, Slovak, Hungarian, or Spanish). Avoid filler and never dump raw internal JSON schemas.
2. Never invent, sum, round, or move amounts across lines. When you report OCR tables, quote the exact table name, position code (such as 01.11.04.A), value, and unit (such as m², PA, kg) returned by the tool.
3. Respect the user's permissions: only use tools that are enabled for their workspace and role. If an app is not installed, tell them plainly and offer to open Manage apps.
4. All domain reads and writes go through Sorye Hub events and signed Rodrigo requests — never claim direct database access.
5. Clearly distinguish between per-user settings (such as GPU execution target: Browser WebGPU vs Hub Server GPU, which belongs to the individual user) and workspace-scoped data (OCR tables, Tasks, Notes, Calendar, Drive files, and Mail, which belong to the active Personal or Team workspace).
6. Keep answers concise and actionable, and tell the user where in Sorye they can see or continue the work.`;

export function describeWorkspaceOwnership(session: HubSession): {
  badge: string;
  headline: string;
  detail: string;
  isPersonal: boolean;
  isOwner: boolean;
  memberCount: number;
} {
  const { user, workspace } = session;
  const isPersonal = workspace.kind === 'personal' || workspace.id === user.personalWorkspaceId;
  const isOwner = workspace.ownerId === user.id;
  const memberCount = Math.max(1, workspace.memberIds?.length ?? 1);

  if (isPersonal) {
    return {
      badge: `${workspace.name} · Personal (Yours)`,
      headline: `"${workspace.name}" (${workspace.id}) is your private Personal workspace.`,
      detail: `Owned exclusively by you (${user.displayName}, ${memberCount} member). Data here is private to you.`,
      isPersonal: true,
      isOwner: true,
      memberCount,
    };
  }

  if (isOwner) {
    return {
      badge: `${workspace.name} · Team (Owned by you)`,
      headline: `"${workspace.name}" (${workspace.id}) is a Team workspace owned by you (${user.displayName}).`,
      detail:
        memberCount === 1
          ? `It is a Team-kind workspace where you are the owner and currently the only member (1 member). You also have a separate Personal workspace (${user.personalWorkspaceId}).`
          : `You are the workspace owner and it is shared with ${memberCount} team members. You also have a separate Personal workspace (${user.personalWorkspaceId}).`,
      isPersonal: false,
      isOwner: true,
      memberCount,
    };
  }

  return {
    badge: `${workspace.name} · Team (Member)`,
    headline: `"${workspace.name}" (${workspace.id}) is a Team workspace you are a member of.`,
    detail: `Owned by ${workspace.ownerId} with ${memberCount} member(s). Your personal workspace is ${user.personalWorkspaceId}.`,
    isPersonal: false,
    isOwner: false,
    memberCount,
  };
}

export function buildMcpAssistantContextPrompt(
  session: HubSession,
  tools: readonly McpToolDescriptor[],
  gpuPreference: UserGpuPreference,
  activeAppId?: string | null,
): string {
  const ownership = describeWorkspaceOwnership(session);
  const availableWorkspaces = (session.workspaces ?? [])
    .map(
      (ws) =>
        `${ws.name} (${ws.kind}, id=${ws.id}${ws.id === session.workspace.id ? ', ACTIVE' : ''})`,
    )
    .join('; ');
  const toolLines = tools
    .map((tool) => `- ${tool.name} (${tool.appId}): ${tool.description}`)
    .join('\n');
  return `${SORYE_MCP_SYSTEM_PROMPT}

User: ${session.user.displayName} (${session.user.email}) · Role: ${session.user.isAdmin ? 'Platform Admin' : 'Member'}
Active workspace: ${session.workspace.name} (${session.workspace.kind}) — ${ownership.headline} ${ownership.detail}
All available workspaces for this user: ${availableWorkspaces || `${session.workspace.name} (${session.workspace.kind})`}
Active app pane: ${activeAppId || 'launcher'}
Selected GPU mode (saved per-user for ${session.user.displayName}): ${gpuPreference.target === 'client-webgpu' ? `Browser WebGPU (${gpuPreference.webGpuModelId})` : `Hub Server GPU #${gpuPreference.hostGpuIndex}`}

Permitted MCP tools for this session:
${toolLines}`;
}

