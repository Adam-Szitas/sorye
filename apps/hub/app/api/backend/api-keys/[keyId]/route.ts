import { NextResponse } from 'next/server';
import { isApiKeyId } from '@sorye/types';
import { ensureHubUser } from '@/lib/ensure-user';
import { revokeRodrigoApiKey, RodrigoResponseError } from '@/lib/rodrigo/service-client';

const noStore = { 'Cache-Control': 'no-store' };
const fail = (status: number, code: string) => NextResponse.json({ error: { code } }, { status, headers: noStore });

/** Revokes a key of the session workspace. Owner only. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ keyId: string }> }) {
  const session = await ensureHubUser();
  if (!session) return fail(401, 'unauthorized');
  if (session.workspace.ownerId !== session.user.id) return fail(403, 'owner_required');
  const { keyId } = await params;
  if (!isApiKeyId(keyId)) return fail(400, 'invalid_api_key');
  try {
    await revokeRodrigoApiKey({ userId: session.user.id, workspaceId: session.workspace.id }, keyId);
    return NextResponse.json({ keyId, revoked: true }, { headers: noStore });
  } catch (error) {
    if (error instanceof RodrigoResponseError) return fail(error.status, error.code);
    return fail(503, 'rodrigo_unavailable');
  }
}
