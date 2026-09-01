import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const TOKEN_PATH = path.join(DATA_DIR, 'protocolio-bridge.json');

interface BridgeTokenStore {
  token: string;
  apiUrl: string;
  updatedAt: string;
}

export function resolveProtocolioApiUrl(): string {
  return (
    process.env.PROTOCOLIO_API_URL?.replace(/\/+$/, '') ||
    'http://127.0.0.1:3100'
  );
}

export function resolveProtocolioDevToken(): string {
  return (
    process.env.PROTOCOLIO_DEV_TOKEN?.trim() ||
    process.env.DEV_TOKEN?.trim() ||
    'local-dev-token'
  );
}

async function readStoredToken(apiUrl: string): Promise<string | null> {
  try {
    const raw = JSON.parse(
      await readFile(TOKEN_PATH, 'utf-8'),
    ) as BridgeTokenStore;
    if (raw.apiUrl === apiUrl && raw.token?.trim()) return raw.token.trim();
  } catch {
    // ignore
  }
  return null;
}

async function writeStoredToken(apiUrl: string, token: string): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const payload: BridgeTokenStore = {
    apiUrl,
    token,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(TOKEN_PATH, JSON.stringify(payload, null, 2), 'utf-8');
}

async function registerToken(apiUrl: string): Promise<string> {
  const res = await fetch(`${apiUrl}/api/auth/register`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      body.error ??
        `Protocolio register failed (${res.status}). Is the API running at ${apiUrl}?`,
    );
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token?.trim()) {
    throw new Error('Protocolio register returned no token');
  }
  await writeStoredToken(apiUrl, data.token);
  return data.token.trim();
}

/** Resolve a usable Bearer token (env DEV_TOKEN, cache, or register). */
export async function ensureProtocolioToken(
  apiUrl = resolveProtocolioApiUrl(),
): Promise<string> {
  const envToken = resolveProtocolioDevToken();
  if (envToken) return envToken;

  const stored = await readStoredToken(apiUrl);
  if (stored) return stored;

  return registerToken(apiUrl);
}

export async function protocolioHealth(
  apiUrl = resolveProtocolioApiUrl(),
): Promise<{ ok: boolean; apiUrl: string; detail?: string }> {
  try {
    const res = await fetch(`${apiUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return {
        ok: false,
        apiUrl,
        detail: `Health returned ${res.status}`,
      };
    }
    return { ok: true, apiUrl };
  } catch (err) {
    return {
      ok: false,
      apiUrl,
      detail:
        err instanceof Error
          ? err.message
          : 'Protocolio API unreachable',
    };
  }
}

export interface BridgeGenerateResult {
  buffer: ArrayBuffer;
  filename: string;
  generationTimeMs: number;
  contentType: string;
}

export async function protocolioGenerate(
  template: unknown,
  apiUrl = resolveProtocolioApiUrl(),
): Promise<BridgeGenerateResult> {
  let token = await ensureProtocolioToken(apiUrl);

  const post = async (bearer: string) =>
    fetch(`${apiUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(template),
      signal: AbortSignal.timeout(60_000),
    });

  let res = await post(token);

  // Env DEV_TOKEN may be wrong / API may prefer registered tokens — retry once.
  if (res.status === 401 || res.status === 403) {
    token = await registerToken(apiUrl);
    res = await post(token);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      body.error ??
        `Protocolio generate failed (${res.status}). Check PROTOCOLIO_API_URL (${apiUrl}) and DEV_TOKEN.`,
    );
  }

  const disposition = res.headers.get('content-disposition') ?? '';
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
  const buffer = await res.arrayBuffer();

  return {
    buffer,
    filename: filenameMatch?.[1] ?? 'document.pdf',
    generationTimeMs: parseInt(
      res.headers.get('x-generation-time-ms') ?? '0',
      10,
    ),
    contentType: res.headers.get('content-type') ?? 'application/pdf',
  };
}
