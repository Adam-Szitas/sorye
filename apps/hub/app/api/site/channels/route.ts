import { NextResponse } from 'next/server';
import { listRodrigoResources } from '@/lib/rodrigo/service-client';
import { rodrigoContext, rodrigoFailure, siteSession } from '@/lib/site-cms/owner';

/**
 * Messenger channels the owner can pick as a contact-form notification target.
 * Read through Hub's shared Rodrigo API; the Site app does not call Messenger.
 * Only public and events channels are offered, so a submission is never posted into
 * a private or direct conversation.
 */
export async function GET() {
  const gate = await siteSession({ write: true });
  if ('response' in gate) return gate.response;
  if (!gate.session.workspace.selectedAppIds.includes('messenger')) return NextResponse.json({ channels: [], messengerEnabled: false }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const listed = await listRodrigoResources(rodrigoContext(gate.session), 'messenger', 'channel', 100);
    const channels = listed.items
      .map(({ resource }) => resource)
      .filter((c) => typeof c.id === 'string' && typeof c.name === 'string' && (c.kind === 'public' || c.kind === 'events'))
      .map((c) => ({ id: c.id as string, name: c.name as string }));
    return NextResponse.json({ channels, messengerEnabled: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return rodrigoFailure(error);
  }
}
