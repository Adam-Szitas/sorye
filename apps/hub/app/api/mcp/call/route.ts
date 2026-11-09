import { ensureHubUser } from '@/lib/ensure-user';
import { executeMcpTool } from '@/lib/mcp/tools';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 32_768) {
      return NextResponse.json({ error: 'MCP tool call payload is too large.' }, { status: 413 });
    }
    body = text.trim() ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'Expected JSON tool call body.' }, { status: 400 });
  }

  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const toolName = typeof record.toolName === 'string' ? record.toolName.trim() : '';
  const args =
    record.arguments && typeof record.arguments === 'object' && !Array.isArray(record.arguments)
      ? (record.arguments as Record<string, unknown>)
      : {};
  const confirmed = record.confirmed === true;

  if (!toolName) {
    return NextResponse.json({ error: 'toolName is required.' }, { status: 400 });
  }

  const result = await executeMcpTool(session, toolName, args, { confirmed });
  const status =
    result.trace.status === 'denied'
      ? 403
      : result.trace.status === 'error' && result.message.startsWith('Unknown MCP tool')
        ? 404
        : 200;

  return NextResponse.json(result, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
