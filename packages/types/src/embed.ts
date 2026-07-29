/** Public view of an embed widget (never includes the raw API key). */
export interface EmbedWidget {
  id: string;
  workspaceId: string;
  name: string;
  keyHint: string;
  /** Origins allowed to iframe this widget (e.g. https://app.example.com). */
  allowedOrigins: string[];
  /**
   * Apps this widget may host. At resolve time each id must also be in the
   * workspace `selectedAppIds` whitelist.
   */
  enabledAppIds: string[];
  createdAt: string;
  createdBy: string;
  revokedAt?: string;
}

/** Returned once when a widget is created — store the key securely. */
export interface EmbedWidgetCreated extends EmbedWidget {
  /** Full secret key — only shown at creation time. */
  apiKey: string;
}

export interface EmbedBootstrapRequest {
  key: string;
  /** Parent page origin (e.g. https://my-app.com). */
  origin: string;
  /** App slug to embed (notes, canvas, …). */
  app: string;
}

export interface EmbedBootstrapResponse {
  token: string;
  embedUrl: string;
  appId: string;
  appName: string;
  expiresAt: string;
}

export function normalizeOrigin(input: string): string | null {
  const trimmed = input.trim().replace(/\/$/, '');
  const match = /^(https?):\/\/([^/\s?#]+)/i.exec(trimmed);
  if (!match) return null;
  const protocol = match[1]!.toLowerCase();
  const host = match[2]!;
  if (!host) return null;
  return `${protocol}://${host}`;
}

export function originAllowed(
  allowedOrigins: string[],
  origin: string,
): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return allowedOrigins.some((entry) => {
    const allowed = normalizeOrigin(entry);
    return allowed !== null && allowed === normalized;
  });
}
