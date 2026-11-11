import { NextResponse } from 'next/server';
import { isApiKeyName, isApiKeyScopeList } from '@sorye/types';
import { ensureHubUser } from '@/lib/ensure-user';
import { publicApiBaseUrl, readSmallJson } from '@/lib/api-keys';
import { createRodrigoApiKey, listRodrigoApiKeys, RodrigoResponseError } from '@/lib/rodrigo/service-client';

const noStore = { 'Cache-Control': 'no-store' };
const fail = (status: number, code: string) => NextResponse.json({ error: { code } }, { status, headers: noStore });

function failure(error: unknown) {
  if (error instanceof RodrigoResponseError) return fail(error.status, error.code);
  return fail(503, 'rodrigo_unavailable');
}

/** Only the workspace owner manages keys: a key can read and change workspace data. */
async function owner() {
  const session = await ensureHubUser();
  if (!session) return { response: fail(401, 'unauthorized') } as const;
  if (session.workspace.ownerId !== session.user.id) return { response: fail(403, 'owner_required') } as const;
  return { context: { userId: session.user.id, workspaceId: session.workspace.id } } as const;
}

export async function GET() {
  const auth = await owner();
  if ('response' in auth) return auth.response;
  try {
    const keys = await listRodrigoApiKeys(auth.context);
    return NextResponse.json({ keys, apiBaseUrl: publicApiBaseUrl() }, { headers: noStore });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const auth = await owner();
  if ('response' in auth) return auth.response;
  const body = await readSmallJson(request);
  if (!body || Object.keys(body).some((key) => key !== 'name' && key !== 'scopes')) return fail(400, 'invalid_api_key');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!isApiKeyName(name) || !isApiKeyScopeList(body.scopes)) return fail(400, 'invalid_api_key');
  try {
    // The token is in this response only. It is not logged, stored or cached by Hub.
    const created = await createRodrigoApiKey(auth.context, { name, scopes: body.scopes });
    return NextResponse.json({ key: created }, { status: 201, headers: noStore });
  } catch (error) {
    return failure(error);
  }
}
