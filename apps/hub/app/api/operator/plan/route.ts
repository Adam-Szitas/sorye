import { ensureHubUser } from '@/lib/ensure-user';
import { operatorDenial } from '@/lib/operator/access';
import { parsePlanCommand } from '@/lib/operator/plan-record';
import { clearPlanSchedule, savePlanSchedule } from '@/lib/operator/schedules';
import { assignWorkspacePlan, operatorWorkspaceExists } from '@/lib/store';
import { SUBSCRIPTION_PLANS, getPlanById } from '@sorye/types';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await ensureHubUser();
  const denied = operatorDenial(session?.user ?? null);
  if (denied || !session) {
    return NextResponse.json(denied?.body ?? { error: 'Unauthorized' }, {
      status: denied?.status ?? 401,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const command = parsePlanCommand(await req.json().catch(() => null));
  if (!command) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }
  if (command.applyNow) {
    const workspace = await assignWorkspacePlan(command.workspaceId, command.subscriptionId);
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    await clearPlanSchedule(command.workspaceId);
    const plan = getPlanById(SUBSCRIPTION_PLANS, workspace.subscriptionId);
    return NextResponse.json({
      ok: true,
      applied: true,
      workspaceId: workspace.id,
      subscriptionId: workspace.subscriptionId,
      planName: plan.name,
      maxApps: plan.maxApps,
    });
  }
  if (!(await operatorWorkspaceExists(command.workspaceId))) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }
  const saved = await savePlanSchedule(command.workspaceId, {
    subscriptionId: command.subscriptionId,
    effectiveAt: command.effectiveAt ?? new Date().toISOString(),
    note: command.note,
  });
  if (!saved) {
    return NextResponse.json({ error: 'Schedule not saved' }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    applied: false,
    workspaceId: command.workspaceId,
    subscriptionId: command.subscriptionId,
    effectiveAt: command.effectiveAt,
    note: command.note,
  });
}
