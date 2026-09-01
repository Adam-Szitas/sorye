import {
  EMBED_TOKEN_TTL_SEC,
  signEmbedToken,
} from '@/lib/embed-token';
import { findEmbedWidgetByKey } from '@/lib/store/embed';
import { getHubSessionForWorkspace } from '@/lib/store';
import {
  APP_CATALOG,
  getAppBySlug,
  originAllowed,
  type EmbedBootstrapResponse,
} from '@sorye/types';
import { NextResponse } from 'next/server';

/**
 * Exchange an embed API key + parent origin for a short-lived embed token.
 * Called by embed.js from the customer's site (CORS enabled for that origin).
 */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    key?: string;
    origin?: string;
    app?: string;
  };

  const key = body.key?.trim();
  const origin = body.origin?.trim();
  const appSlug = body.app?.trim();

  if (!key || !origin || !appSlug) {
    return NextResponse.json(
      { error: 'key, origin, and app are required' },
      { status: 400 },
    );
  }

  const widget = await findEmbedWidgetByKey(key);
  if (!widget) {
    return NextResponse.json({ error: 'Invalid embed key' }, { status: 401 });
  }

  if (!originAllowed(widget.allowedOrigins, origin)) {
    return NextResponse.json(
      { error: 'Origin is not whitelisted for this embed key' },
      { status: 403 },
    );
  }

  const catalogApp = getAppBySlug(APP_CATALOG, appSlug);
  if (
    !catalogApp ||
    catalogApp.status !== 'available' ||
    !catalogApp.microFrontend
  ) {
    return NextResponse.json(
      { error: 'Unknown or unavailable app' },
      { status: 404 },
    );
  }

  const hubSession = await getHubSessionForWorkspace(
    widget.createdBy,
    widget.workspaceId,
  );
  if (!hubSession) {
    return NextResponse.json(
      { error: 'Workspace unavailable for this embed key' },
      { status: 403 },
    );
  }

  const selected = new Set(hubSession.workspace.selectedAppIds);
  const enabled = new Set(widget.enabledAppIds);
  if (!enabled.has(catalogApp.id) || !selected.has(catalogApp.id)) {
    return NextResponse.json(
      {
        error:
          'This app is not enabled for the embed key (or not selected in the hub workspace).',
      },
      { status: 403 },
    );
  }

  const exp = Math.floor(Date.now() / 1000) + EMBED_TOKEN_TTL_SEC;
  const token = signEmbedToken({
    wid: widget.id,
    ws: widget.workspaceId,
    uid: hubSession.user.id,
    apps: widget.enabledAppIds.filter((id) => selected.has(id)),
    origins: widget.allowedOrigins,
    app: catalogApp.slug,
    exp,
  });

  const hubOrigin = new URL(req.url).origin;
  const payload: EmbedBootstrapResponse = {
    token,
    embedUrl: `${hubOrigin}/api/embed/enter?app=${encodeURIComponent(catalogApp.slug)}&t=${encodeURIComponent(token)}`,
    appId: catalogApp.id,
    appName: catalogApp.name,
    expiresAt: new Date(exp * 1000).toISOString(),
  };

  return NextResponse.json(payload, {
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    },
  });
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get('Origin');
  if (!origin) {
    return new NextResponse(null, { status: 204 });
  }
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  });
}
