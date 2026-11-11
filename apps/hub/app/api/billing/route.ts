import { isBillingCommand } from '@sorye/types';
import { NextResponse } from 'next/server';
import { getBillingSnapshot, runBillingCommand } from '@/lib/billing/service';
import { ensureHubUser } from '@/lib/ensure-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store' };
const STATUS = { unavailable: 503, forbidden: 403, invalid: 400, sales_led: 409, no_change: 409 } as const;

/** Plan, billing state and usage of the active workspace. The workspace comes from the session. */
export async function GET() {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  return NextResponse.json(await getBillingSnapshot(session), { headers: noStore });
}

/** Change plan, cancel or resume. Owner only. */
export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  const body = await req.json().catch(() => null);
  if (!isBillingCommand(body)) return NextResponse.json({ ok: false, code: 'invalid' }, { status: 400, headers: noStore });
  const result = await runBillingCommand(session, body);
  return NextResponse.json(result, { status: result.ok ? 200 : STATUS[result.code], headers: noStore });
}
