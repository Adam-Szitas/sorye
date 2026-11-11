import { ensureHubUser } from '@/lib/ensure-user';
import { viewerPersonalPackageAppIds } from '@/lib/personal-package';
import { updateWorkspace } from '@/lib/store';
import type { ConnectedApp } from '@sorye/types';
import { NextResponse } from 'next/server';
import { ServerTimings } from '@/lib/server-timing';
import { getRodrigoResource, RodrigoResponseError } from '@/lib/rodrigo/service-client';

export async function GET() {
  const timings = new ServerTimings();
  const hubSession = await timings.measure('session', () => ensureHubUser(timings));
  if (!hubSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: timings.headers() });
  }

  let profile: { revision: number; resource: Record<string, unknown> | null };
  // False while Rodrigo is not configured or not reachable. The shell still opens
  // with default profile values; apps that need Rodrigo report that themselves.
  let profileAvailable = true;
  try {
    profile = await getRodrigoResource(
      { userId: hubSession.user.id, workspaceId: hubSession.workspace.id },
      'workspace', 'settings', 'main',
    );
  } catch (error) {
    if (error instanceof RodrigoResponseError && error.status < 500) {
      // A real refusal from Rodrigo (forbidden, conflict, …) is not hidden.
      return NextResponse.json({ error: { code: error.code } }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
    }
    profileAvailable = false;
    profile = { revision: 0, resource: null };
  }

  const defaults = {
    name: profileAvailable
      ? (hubSession.workspace.kind === 'personal' ? 'Personal workspace' : 'Workspace')
      : hubSession.workspace.name,
    locale: 'en', timezone: 'UTC',
  };
  const resource = profile.resource;
  const settings = resource && typeof resource.name === 'string' && typeof resource.locale === 'string' && typeof resource.timezone === 'string'
    ? { name: resource.name, locale: resource.locale, timezone: resource.timezone, revision: profile.revision }
    : { ...defaults, revision: profile.revision };
  const session = { ...hubSession, workspace: { ...hubSession.workspace, name: settings.name } };

  const personalPackageAppIds = await viewerPersonalPackageAppIds(hubSession);
  return NextResponse.json(
    { ...session, workspaceSettings: { ...settings, profileAvailable }, personalPackageAppIds },
    { headers: { ...timings.headers(), 'Cache-Control': 'private, no-store' } },
  );
}

export async function PATCH(req: Request) {
  const hubSession = await ensureHubUser();
  if (!hubSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const input: unknown = await req.json().catch(() => ({}));
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  if (Object.hasOwn(body, 'name') || Object.hasOwn(body, 'locale') || Object.hasOwn(body, 'timezone')) {
    return NextResponse.json({ error: { code: 'workspace_profile_writer_disabled', route: '/api/workspace/profile' } }, { status: 410 });
  }

  const policyPatch = body as { selectedAppIds?: string[]; connectedApps?: ConnectedApp[] };

  const updated = await updateWorkspace(
    hubSession.user.id,
    hubSession.workspace.id,
    policyPatch,
  );

  if (!updated) {
    return NextResponse.json({ error: 'Update failed' }, { status: 400 });
  }

  return NextResponse.json(updated);
}

