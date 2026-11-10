import {
  adminAccess,
  adminDenied,
  adminNoStore,
  adminRateLimited,
  adminWriteLimited,
  readAdminJson,
} from '@/lib/admin/access';
import { AdminAuditUnavailableError, auditedAdminAction } from '@/lib/admin/audit';
import { parsePlanCommand } from '@/lib/operator/plan-record';
import { clearPlanSchedule, savePlanSchedule } from '@/lib/operator/schedules';
import { assignWorkspacePlan, operatorWorkspaceExists } from '@/lib/store';
import { SUBSCRIPTION_PLANS, getPlanById } from '@sorye/types';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PlanOutcome = { status: number; body: Record<string, unknown> };

export async function POST(req: Request) {
  const access = await adminAccess();
  if (!access.ok) return adminDenied(access);
  if (adminWriteLimited(access.actor.actorId)) return adminRateLimited();
  const command = parsePlanCommand(await readAdminJson(req));
  if (!command) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400, headers: adminNoStore });
  }
  try {
    const audited = await auditedAdminAction<PlanOutcome>(access.actor, {
      action: command.applyNow ? 'workspace.plan.assign' : 'workspace.plan.schedule',
      targetType: 'workspace',
      targetId: command.workspaceId,
      details: {
        subscriptionId: command.subscriptionId,
        effectiveAt: command.effectiveAt ?? null,
        hasNote: Boolean(command.note),
      },
    }, async () => {
      if (command.applyNow) {
        const workspace = await assignWorkspacePlan(command.workspaceId, command.subscriptionId);
        if (!workspace) {
          return { outcome: 'failed', details: { code: 'workspace_not_found' }, result: { status: 404, body: { error: 'Workspace not found' } } };
        }
        await clearPlanSchedule(command.workspaceId);
        const plan = getPlanById(SUBSCRIPTION_PLANS, workspace.subscriptionId);
        return {
          outcome: 'succeeded',
          result: {
            status: 200,
            body: {
              ok: true,
              applied: true,
              workspaceId: workspace.id,
              subscriptionId: workspace.subscriptionId,
              planName: plan.name,
              maxApps: plan.maxApps,
            },
          },
        };
      }
      if (!(await operatorWorkspaceExists(command.workspaceId))) {
        return { outcome: 'failed', details: { code: 'workspace_not_found' }, result: { status: 404, body: { error: 'Workspace not found' } } };
      }
      const saved = await savePlanSchedule(command.workspaceId, {
        subscriptionId: command.subscriptionId,
        effectiveAt: command.effectiveAt ?? new Date().toISOString(),
        note: command.note,
      });
      if (!saved) {
        return { outcome: 'failed', details: { code: 'schedule_not_saved' }, result: { status: 400, body: { error: 'Schedule not saved' } } };
      }
      return {
        outcome: 'succeeded',
        result: {
          status: 200,
          body: {
            ok: true,
            applied: false,
            workspaceId: command.workspaceId,
            subscriptionId: command.subscriptionId,
            effectiveAt: command.effectiveAt,
            note: command.note,
          },
        },
      };
    });
    return NextResponse.json(
      { ...audited.result.body, correlationId: audited.correlationId, auditOutcomeRecorded: audited.outcomeRecorded },
      { status: audited.result.status, headers: adminNoStore },
    );
  } catch (error) {
    if (error instanceof AdminAuditUnavailableError) {
      return NextResponse.json({ error: 'audit_unavailable' }, { status: 503, headers: adminNoStore });
    }
    throw error;
  }
}
