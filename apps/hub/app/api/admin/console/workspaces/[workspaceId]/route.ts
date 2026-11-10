import { adminAccess, adminDenied, adminNoStore } from '@/lib/admin/access';
import { listPlanSchedules } from '@/lib/operator/schedules';
import { getWorkspaceMembers, listOperatorWorkspaces } from '@/lib/store';
import { APP_CATALOG, SUBSCRIPTION_PLANS, getPlanById, getSelectedApps, selectableAppCount } from '@sorye/types';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MEMBERS = 200;

/**
 * Read-only access review for one explicitly chosen workspace. Membership changes
 * stay with the workspace owner flows; the console does not edit them.
 */
export async function GET(_req: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  const { workspaceId } = await context.params;
  if (!workspaceId || workspaceId.length > 160) {
    return NextResponse.json({ error: 'invalid_workspace' }, { status: 400, headers: adminNoStore });
  }
  const [workspaces, schedules] = await Promise.all([listOperatorWorkspaces(), listPlanSchedules()]);
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) return NextResponse.json({ error: 'workspace_not_found' }, { status: 404, headers: adminNoStore });
  const members = await getWorkspaceMembers(workspace.id);
  const plan = getPlanById(SUBSCRIPTION_PLANS, workspace.subscriptionId);
  return NextResponse.json({
    workspace: {
      id: workspace.id,
      name: workspace.name,
      kind: workspace.kind,
      subscriptionId: workspace.subscriptionId,
      planName: plan.name,
      maxApps: plan.maxApps,
      selectedAppCount: selectableAppCount(APP_CATALOG, workspace.selectedAppIds),
      apps: getSelectedApps(APP_CATALOG, workspace.selectedAppIds).map((app) => ({
        id: app.id,
        name: app.name,
        alwaysAvailable: Boolean(app.alwaysAvailable),
      })),
      schedule: schedules[workspace.id] ?? null,
    },
    members: members.slice(0, MAX_MEMBERS).map((member) => ({
      id: member.id,
      displayName: member.displayName,
      email: member.email,
    })),
    membersTruncated: members.length > MAX_MEMBERS,
  }, { headers: adminNoStore });
}
