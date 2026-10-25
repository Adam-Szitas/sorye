/** Hub origin for a tasks tab opened on its own Vite port. Empty when `/api` is same-origin. */
export function readHubOrigin(): string | undefined {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const value = env?.VITE_HUB_ORIGIN?.trim();
  return value || undefined;
}

/**
 * Relative `/api/...` on the Hub origin (embedded Module Federation).
 * Absolute Hub URL when this document is the Vite port and `VITE_HUB_ORIGIN` is set.
 */
export function hubApiPath(path: string): string {
  const origin = readHubOrigin();
  if (!origin || typeof window === 'undefined') return path;
  try {
    if (window.location.origin === new URL(origin).origin) return path;
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
}
