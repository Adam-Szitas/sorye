import { ensureHubUser } from '@/lib/ensure-user';
import { publishWorkspaceEvent } from '@/lib/events';
import { assertJsonPayloadSize, MAX_SITE_BYTES } from '@/lib/security-limits';
import { getSiteForWorkspace, saveSiteForWorkspace, siteSharePath } from '@/lib/site';
import type { SiteBlock, SiteEditorInput } from '@sorye/types';
import { NextResponse } from 'next/server';

function editorPayload(page: Awaited<ReturnType<typeof getSiteForWorkspace>>) {
  return {
    site: page,
    sharePath: siteSharePath(page.slug),
  };
}

export async function GET() {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const site = await getSiteForWorkspace(session.workspace.id, session.workspace.name);
  return NextResponse.json(editorPayload(site));
}

export async function PUT(req: Request) {
  const session = await ensureHubUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<SiteEditorInput> & {
    workspaceId?: unknown;
    slug?: unknown;
  };

  if (body.workspaceId != null || body.slug != null) {
    return NextResponse.json(
      { error: 'workspaceId and slug cannot be set by the client' },
      { status: 400 },
    );
  }

  try {
    assertJsonPayloadSize(body, MAX_SITE_BYTES, 'Site');
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Payload too large' },
      { status: 400 },
    );
  }

  const blocks = Array.isArray(body.blocks) ? (body.blocks as SiteBlock[]) : undefined;

  try {
    const { page, justPublished } = await saveSiteForWorkspace(
      session.workspace.id,
      session.workspace.name,
      {
        published: body.published,
        displayName: body.displayName,
        blocks,
      },
    );

    if (justPublished) {
      await publishWorkspaceEvent({
        userId: session.user.id,
        workspaceId: session.workspace.id,
        name: 'sorye.site.published',
        payload: {
          title: 'Site published',
          summary: page.displayName,
          appId: 'site',
          entityId: page.slug,
        },
      });
    }

    return NextResponse.json(editorPayload(page));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not save page' },
      { status: 400 },
    );
  }
}

export { PUT as POST };
