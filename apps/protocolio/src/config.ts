/** Default API base URL — empty string uses same origin (Vite dev proxy → localhost:3000). */
export const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? '';

/** Local dev token — must match DEV_TOKEN in protocolio/.env */
export const DEV_TOKEN = import.meta.env.VITE_DEV_TOKEN ?? '';

export function resolveApiBaseUrl(): string {
  const saved = localStorage.getItem('protocolio_base_url');
  // Avoid direct :3000 calls from the browser — use Vite proxy on the dev-server origin
  if (saved && !/:3000\/?$/.test(saved.replace(/\/+$/, ''))) {
    return saved;
  }
  if (DEFAULT_API_BASE_URL) return DEFAULT_API_BASE_URL;
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3007';
}

export function resolveDevToken(): string {
  const saved = localStorage.getItem('protocolio_token');
  if (saved?.trim()) return saved.trim();
  return DEV_TOKEN.trim();
}
