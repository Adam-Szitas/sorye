import { NextResponse } from 'next/server';
import { normalizeLocale } from '@sorye/site-sdk';
import { deriveActionQueueScope } from '@/lib/rodrigo/queue-scope';
import { loadDrafts } from '@/lib/site-cms/drafts';
import { rodrigoContext, rodrigoFailure, siteSession } from '@/lib/site-cms/owner';
import { readSiteManifest } from '@/lib/site-cms/public-client';

/**
 * The CMS editor's view of this workspace's site: drafts with revisions, the live
 * revision id, the action-queue scope and, before the first CMS save, the earlier
 * one-page Site converted to CMS sections (not saved until the owner chooses to).
 */
export async function GET(req: Request) {
  const gate = await siteSession();
  if ('response' in gate) return gate.response;
  const { session } = gate;
  const context = rodrigoContext(session);
  try {
    const legacyLocale = normalizeLocale(req.headers.get('accept-language')?.split(',')[0] ?? '') ?? 'en';
    const drafts = await loadDrafts(context, { submissions: true, legacyLocale });
    let live: { revisionId: string; publishedAt: string } | null = null;
    if (drafts.settings) {
      const manifest = await readSiteManifest(drafts.settings.value.slug).catch(() => null);
      if (manifest) live = { revisionId: manifest.revisionId, publishedAt: manifest.publishedAt };
    }
    return NextResponse.json({
      drafts, live,
      queueScope: deriveActionQueueScope('site', session.user.id, session.workspace.id),
      canEdit: session.workspace.ownerId === session.user.id,
      workspace: { id: session.workspace.id, name: session.workspace.name },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return rodrigoFailure(error);
  }
}
