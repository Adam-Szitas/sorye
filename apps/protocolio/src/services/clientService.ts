import {
  ProtocolioClient,
  type ProtocolioConfig,
  type PdfTemplate,
  type GenerateResult,
  type ValidationResult,
} from '@protocolio/sdk';
import { resolveApiBaseUrl, resolveDevToken } from '../config';

const STORAGE_KEY_BASE_URL = 'protocolio_base_url';
const STORAGE_KEY_TOKEN = 'protocolio_token';

let client: ProtocolioClient | null = null;
/** Prefer Hub developer bridge (no browser Bearer token). */
let preferHubBridge = true;

function loadSavedConfig(): ProtocolioConfig {
  const savedUrl = localStorage.getItem(STORAGE_KEY_BASE_URL);
  const token = resolveDevToken();
  const baseUrl = savedUrl !== null && savedUrl !== '' ? savedUrl : resolveApiBaseUrl();
  return { baseUrl, token };
}

function persistConfig(config: ProtocolioConfig): void {
  localStorage.setItem(STORAGE_KEY_BASE_URL, config.baseUrl);
  localStorage.setItem(STORAGE_KEY_TOKEN, config.token);
}

const initialConfig = loadSavedConfig();
if (initialConfig.token && !localStorage.getItem(STORAGE_KEY_TOKEN)) {
  persistConfig(initialConfig);
}
client = new ProtocolioClient(initialConfig);

export function initClient(config: ProtocolioConfig): ProtocolioClient {
  persistConfig(config);
  client = new ProtocolioClient(config);
  // Explicit connect still allows direct Protocolio API usage.
  preferHubBridge = false;
  return client;
}

/** Keep using Hub bridge (recommended for Sorye local dev). */
export function useHubBridge(enabled = true): void {
  preferHubBridge = enabled;
}

export function getClient(): ProtocolioClient | null {
  return client;
}

export function hasToken(): boolean {
  // Hub bridge means developers do not need a browser-side token.
  if (preferHubBridge) return true;
  return !!resolveDevToken();
}

export function getBaseUrl(): string {
  return loadSavedConfig().baseUrl;
}

export async function bridgeHealth(): Promise<{
  ok: boolean;
  apiUrl?: string;
  detail?: string;
}> {
  try {
    const res = await fetch('/api/protocolio/health', {
      credentials: 'include',
    });
    if (!res.ok) {
      return { ok: false, detail: `Hub bridge ${res.status}` };
    }
    return (await res.json()) as {
      ok: boolean;
      apiUrl?: string;
      detail?: string;
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'Bridge unreachable',
    };
  }
}

async function generateViaHubBridge(
  template: PdfTemplate,
): Promise<GenerateResult> {
  const res = await fetch('/api/protocolio/generate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      hint?: string;
    };
    const message = [body.error, body.hint].filter(Boolean).join(' — ');
    throw new Error(message || `Hub Protocolio bridge failed (${res.status})`);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);

  return {
    data: blob,
    generationTimeMs: parseInt(
      res.headers.get('x-generation-time-ms') ?? '0',
      10,
    ),
    filename: filenameMatch?.[1] ?? 'document.pdf',
  };
}

export async function generate(template: PdfTemplate): Promise<GenerateResult> {
  let result: GenerateResult;
  if (preferHubBridge) {
    try {
      result = await generateViaHubBridge(template);
    } catch (bridgeErr) {
      // Fall through to direct client if a token exists.
      if (!resolveDevToken() || !client) throw bridgeErr;
      result = await client.generate(template);
    }
  } else {
    if (!client) throw new Error('Client not initialized. Call initClient() first.');
    result = await client.generate(template);
  }

  void import('../emit-event').then(({ emitWorkspaceEvent }) =>
    emitWorkspaceEvent('sorye.protocolio.generated', {
      title: `PDF ready: ${result.filename}`,
      summary: `Generated in ${result.generationTimeMs}ms`,
      appId: 'protocolio',
      meta: {
        filename: result.filename,
        generationTimeMs: result.generationTimeMs,
      },
    }),
  );

  return result;
}

export async function validate(template: PdfTemplate): Promise<ValidationResult> {
  if (!client) throw new Error('Client not initialized. Call initClient() first.');
  return client.validate(template);
}

export async function download(template: PdfTemplate, filename?: string): Promise<void> {
  const result = await generate(template);
  const url = URL.createObjectURL(result.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function health(): Promise<boolean> {
  if (preferHubBridge) {
    const bridge = await bridgeHealth();
    if (bridge.ok) return true;
  }
  if (!client) return false;
  return client.health();
}
