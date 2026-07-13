'use client';

import type { HubSession } from '@sorye/types';
import useSWR from 'swr';
import {
  fetchHubSession,
  HUB_SESSION_KEY,
} from '@/lib/hub-session-fetcher';

async function patchHubSession(patch: {
  selectedAppIds?: string[];
  connectedApps?: HubSession['workspace']['connectedApps'];
  name?: string;
}): Promise<HubSession> {
  const res = await fetch('/api/workspace', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Update failed');
  return res.json() as Promise<HubSession>;
}

async function postWorkspaceAction(
  body:
    | { action: 'switch'; workspaceId: string }
    | { action: 'create-team'; name: string },
): Promise<HubSession> {
  const res = await fetch('/api/workspace/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Workspace action failed');
  return res.json() as Promise<HubSession>;
}

interface UseHubSessionOptions {
  initialData?: HubSession | null;
}

export function useHubSession(options: UseHubSessionOptions = {}) {
  const { data, error, isLoading, mutate } = useSWR<HubSession>(
    HUB_SESSION_KEY,
    fetchHubSession,
    {
      fallbackData: options.initialData ?? undefined,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5_000,
      keepPreviousData: true,
    },
  );

  const patchWorkspace = async (patch: {
    selectedAppIds?: string[];
    connectedApps?: HubSession['workspace']['connectedApps'];
    name?: string;
  }) => {
    const updated = await patchHubSession(patch);
    await mutate(updated, { revalidate: false });
    return updated;
  };

  const switchWorkspace = async (workspaceId: string) => {
    const updated = await postWorkspaceAction({
      action: 'switch',
      workspaceId,
    });
    await mutate(updated, { revalidate: false });
    return updated;
  };

  const createTeam = async (name: string) => {
    const updated = await postWorkspaceAction({
      action: 'create-team',
      name,
    });
    await mutate(updated, { revalidate: false });
    return updated;
  };

  const refresh = () => mutate();

  return {
    session: data ?? null,
    loading: isLoading && !data,
    error: error?.message ?? null,
    refresh,
    patchWorkspace,
    switchWorkspace,
    createTeam,
  };
}
