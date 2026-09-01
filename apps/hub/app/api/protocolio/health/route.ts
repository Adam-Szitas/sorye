import { ensureHubUser } from '@/lib/ensure-user';
import {
  protocolioHealth,
  resolveProtocolioApiUrl,
  resolveProtocolioDevToken,
} from '@/lib/protocolio-bridge';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const health = await protocolioHealth();
  const isAdmin = session.user.isAdmin;

  if (!isAdmin) {
    return NextResponse.json({ ok: health.ok });
  }

  return NextResponse.json({
    ...health,
    bridge: true,
    hasDevToken: Boolean(resolveProtocolioDevToken()),
    apiUrl: resolveProtocolioApiUrl(),
  });
}
