'use client';

import type { HubSession } from '@sorye/types';
import { createDurableActionQueue } from '@sorye/platform';
import type { RodrigoAction, RodrigoActionBatchResult } from '@sorye/types';
import { useCallback, useEffect } from 'react';
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

async function patchWorkspaceProfile(name: string): Promise<HubSession> {
  const normalizedName = name.trim().slice(0, 120);
  if (!normalizedName) throw new Error('Workspace name is required.');
  const scopeResponse = await fetch('/api/workspace/profile/scope', { credentials: 'include', cache: 'no-store' });
  if (!scopeResponse.ok) throw new Error('Could not authorize workspace profile changes.');
  const { queueScope } = await scopeResponse.json() as { queueScope: string };
  if (!/^[a-f0-9]{64}$/.test(queueScope)) throw new Error('Hub returned an invalid workspace queue scope.');
  const queue = createDurableActionQueue<RodrigoAction>({ appId: 'workspace', scope: queueScope, maxRows: 100 });
  const snapshotResponse = await fetch('/api/backend/resources/workspace/settings/main', { credentials: 'include', cache: 'no-store' });
  if (!snapshotResponse.ok) throw new Error('Could not read the authoritative workspace profile from Rodrigo.');
  const snapshot = await snapshotResponse.json() as { revision: number; resource: Record<string, unknown> | null };
  const now = new Date().toISOString();
  const action: RodrigoAction = {
    actionId: crypto.randomUUID(), appId: 'workspace', resourceType: 'settings', operation: snapshot.resource ? 'update' : 'create',
    resourceId: 'main', ...(snapshot.resource ? { expectedRevision: snapshot.revision } : {}), payloadVersion: 1,
    payload: {
      name: normalizedName,
      locale: typeof snapshot.resource?.locale === 'string' ? snapshot.resource.locale : 'en',
      timezone: typeof snapshot.resource?.timezone === 'string' ? snapshot.resource.timezone : 'UTC',
      updatedAt: now,
    }, occurredAt: now,
  };
  await queue.enqueue(action);
  const pending = (await queue.list()).filter((row) => row.status === 'pending' || row.status === 'failed');
  for (const row of pending) {
    await queue.markAttempt(row.action.actionId);
    let outcomeError: string | undefined;
    try {
      const response = await fetch('/api/backend/actions/batch', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Sorye-Queue-Scope': queueScope },
        body: JSON.stringify({ actions: [row.action] }),
      });
      if (!response.ok) throw new Error('Rodrigo could not confirm the workspace profile change.');
      const result = await response.json() as RodrigoActionBatchResult;
      const outcome = result.results.find((item) => item.actionId === row.action.actionId);
      if (!outcome) throw new Error('Rodrigo returned no result for the workspace profile action.');
      await queue.settle(outcome);
      if (outcome.status !== 'committed' && outcome.status !== 'duplicate') {
        outcomeError = outcome.error?.message ?? 'Workspace profile change needs reconciliation.';
      }
    } catch (error) {
      await queue.markTransportFailure(row.action.actionId, { code: 'transport_failure', message: error instanceof Error ? error.message : 'Request failed' });
      throw error;
    }
    if (outcomeError) throw new Error(outcomeError);
  }
  const remaining = await queue.list();
  if (remaining.length) throw new Error('Workspace profile changes remain queued for retry or reconciliation.');
  const response = await fetch('/api/workspace', { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error('Workspace profile was saved, but Hub could not refresh the session.');
  return response.json() as Promise<HubSession>;
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

  const patchWorkspace = useCallback(
    async (patch: {
      selectedAppIds?: string[];
      connectedApps?: HubSession['workspace']['connectedApps'];
      name?: string;
    }) => {
      if (Object.hasOwn(patch, 'name')) {
        if (Object.keys(patch).some((key) => key !== 'name')) throw new Error('Change workspace profile and app access settings separately.');
        const updated = await patchWorkspaceProfile(patch.name ?? '');
        await mutate(updated, { revalidate: false });
        return updated;
      }
      const updated = await patchHubSession(patch);
      await mutate(updated, { revalidate: false });
      return updated;
    },
    [mutate],
  );

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      const updated = await postWorkspaceAction({
        action: 'switch',
        workspaceId,
      });
      await mutate(updated, { revalidate: false });
      return updated;
    },
    [mutate],
  );

  const createTeam = useCallback(
    async (name: string) => {
      const updated = await postWorkspaceAction({
        action: 'create-team',
        name,
      });
      await mutate(updated, { revalidate: false });
      return updated;
    },
    [mutate],
  );

  const refresh = useCallback(() => mutate(), [mutate]);

  useEffect(() => {
    const onSwitch = () => {
      void mutate();
    };
    window.addEventListener('sorye:workspace-switched', onSwitch);
    return () => window.removeEventListener('sorye:workspace-switched', onSwitch);
  }, [mutate]);

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
