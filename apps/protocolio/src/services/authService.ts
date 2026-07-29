export interface ProvisionResponse {
  token: string;
  tier: number;
}

/** Provision a new API token (intended for backend services). */
export async function provisionToken(baseUrl: string): Promise<ProvisionResponse> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Token provisioning failed');
  }

  return (await res.json()) as ProvisionResponse;
}
