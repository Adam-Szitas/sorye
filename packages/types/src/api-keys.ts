/**
 * Workspace API keys for Rodrigo's public `/api/v1` surface.
 * Mirrors Rodrigo's `api_keys` rules; Rodrigo is authoritative.
 */

/** Apps reachable with an API key. Other apps are not exposed by the public API yet. */
export const API_KEY_APPS = ['tasks', 'notes', 'calendar', 'forms'] as const;
export type ApiKeyApp = (typeof API_KEY_APPS)[number];
export type ApiKeyAccess = 'read' | 'write';
export type ApiKeyScope = `${ApiKeyApp}:${ApiKeyAccess}`;

export const API_KEY_SCOPES: readonly ApiKeyScope[] = API_KEY_APPS.flatMap((app) => [`${app}:read`, `${app}:write`] as ApiKeyScope[]);
export const API_KEY_MAX_PER_WORKSPACE = 20;

export interface ApiKeySummary {
  /** Public identifier, safe to show. Not the secret. */
  keyId: string;
  name: string;
  scopes: string[];
  createdByUserId: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

/** Returned once, when a key is created. `token` is never available again. */
export interface ApiKeyCreated {
  keyId: string;
  name: string;
  scopes: string[];
  token: string;
}

export function isApiKeyScope(value: unknown): value is ApiKeyScope {
  return typeof value === 'string' && (API_KEY_SCOPES as readonly string[]).includes(value);
}

export function isApiKeyId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

/** Name rules match Rodrigo: 1 to 80 bytes, no surrounding space, no control characters. */
export function isApiKeyName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    new TextEncoder().encode(value).length <= 80 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

export function isApiKeyScopeList(value: unknown): value is ApiKeyScope[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 16 && value.every(isApiKeyScope) && new Set(value).size === value.length;
}
