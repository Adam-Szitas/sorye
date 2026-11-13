import { NextResponse } from 'next/server';
import { ensureHubUser } from '@/lib/ensure-user';
import { RodrigoResponseError } from '@/lib/rodrigo/service-client';

export type HubSession = NonNullable<Awaited<ReturnType<typeof ensureHubUser>>>;

/**
 * Session gate for Site CMS routes. Members of a workspace with Site enabled may read;
 * only the owner writes (Rodrigo writes are additionally owner-only in the batch route).
 * The workspace always comes from the session.
 */
export async function siteSession(options: { write?: boolean } = {}): Promise<{ session: HubSession } | { response: NextResponse }> {
  const session = await ensureHubUser();
  if (!session) return { response: NextResponse.json({ error: { code: 'unauthorized' } }, { status: 401, headers: { 'Cache-Control': 'no-store' } }) };
  if (!session.workspace.memberIds.includes(session.user.id) || !session.workspace.selectedAppIds.includes('site')) {
    return { response: NextResponse.json({ error: { code: 'app_access_denied' } }, { status: 403, headers: { 'Cache-Control': 'no-store' } }) };
  }
  if (options.write && session.workspace.ownerId !== session.user.id) {
    return { response: NextResponse.json({ error: { code: 'operation_forbidden' } }, { status: 403, headers: { 'Cache-Control': 'no-store' } }) };
  }
  return { session };
}

export function rodrigoContext(session: HubSession) {
  return { userId: session.user.id, workspaceId: session.workspace.id };
}

export function rodrigoFailure(error: unknown): NextResponse {
  const status = error instanceof RodrigoResponseError ? error.status : 503;
  const code = error instanceof RodrigoResponseError ? error.code : 'rodrigo_unavailable';
  return NextResponse.json({ error: { code } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Content type from the first bytes. The browser's claimed type is never trusted. */
export function sniffMediaType(head: Uint8Array): string | null {
  const b = head;
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (b.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 4))) return 'image/avif';
  if (b.length >= 5 && ascii(0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
