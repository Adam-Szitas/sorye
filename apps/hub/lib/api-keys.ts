/**
 * Public address of Rodrigo's `/api/v1` surface, shown to owners next to their keys.
 * `RODRIGO_PUBLIC_API_URL` is deployment configuration; it is not the private
 * `RODRIGO_BASE_URL` Hub itself calls. `null` when the operator has not published one.
 */
export function publicApiBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.RODRIGO_PUBLIC_API_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Parses a JSON object body of at most 4 KB. `null` for anything else. */
export async function readSmallJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > 4096) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
