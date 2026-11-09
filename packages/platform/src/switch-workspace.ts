/** Calls the existing authorized workspace switch. The server ignores ids the user does not belong to. */
export async function switchAuthorizedWorkspace(workspaceId: string): Promise<boolean> {
  const res = await fetch('/api/workspace/team', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'switch', workspaceId }),
  });
  if (!res.ok) return false;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sorye:workspace-switched'));
  }
  return true;
}
