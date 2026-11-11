import { isBillingSimulation } from '@sorye/types';
import { NextResponse } from 'next/server';
import { billingMode, runBillingSimulation } from '@/lib/billing/service';
import { ensureHubUser } from '@/lib/ensure-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };

/**
 * Test tunnel: plays a payment-provider event (failed payment, grace, renewal)
 * against the active workspace. Exists only while BILLING_SIMULATOR=true outside production.
 */
export async function POST(req: Request) {
  if (billingMode() !== 'simulated') return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore });
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  const body = (await req.json().catch(() => null)) as { event?: unknown } | null;
  if (!body || !isBillingSimulation(body.event)) return NextResponse.json({ ok: false, code: 'invalid' }, { status: 400, headers: noStore });
  const result = await runBillingSimulation(session, body.event);
  const status = result.ok ? 200 : result.code === 'forbidden' ? 403 : result.code === 'unavailable' ? 404 : 409;
  return NextResponse.json(result, { status, headers: noStore });
}
