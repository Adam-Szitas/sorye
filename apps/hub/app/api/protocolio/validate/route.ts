import { readProtocolioTemplate } from '@/lib/protocolio-input';
import { ensureHubUser } from '@/lib/ensure-user';
import { ensureProtocolioToken, resolveProtocolioApiUrl } from '@/lib/protocolio-bridge';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const template = await readProtocolioTemplate(req).catch(() => null);
  if (!template || !Array.isArray((template as {blocks?:unknown}).blocks)) return NextResponse.json({ error: 'A template with blocks is required' }, { status: 400 });
  if (JSON.stringify(template).length > 2_000_000) return NextResponse.json({ error: 'Template too large' }, { status: 413 });
  try {
    const token = await ensureProtocolioToken();
    const response = await fetch(resolveProtocolioApiUrl() + '/api/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(template), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('Validation unavailable');
    return NextResponse.json(await response.json());
  } catch { return NextResponse.json({ error: 'PDF validation unavailable' }, { status: 502 }); }
}
