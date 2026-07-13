import type { HubSession } from '@sorye/types';

export async function fetchHubSession(): Promise<HubSession> {
  const res = await fetch('/api/workspace');
  if (!res.ok) throw new Error('Failed to load workspace');
  return res.json() as Promise<HubSession>;
}

export const HUB_SESSION_KEY = '/api/workspace';
