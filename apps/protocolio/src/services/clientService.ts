import type { ProtocolioConfig, PdfTemplate, GenerateResult, ValidationResult } from '@protocolio/sdk';
export function initClient(_config: ProtocolioConfig): void {}
export function useHubBridge(_enabled = true): void {}
export function hasToken(): boolean { return true; }
export function getBaseUrl(): string { return '/api/protocolio'; }

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
  const result = await generateViaHubBridge(template);

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
  const res = await fetch('/api/protocolio/validate', {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'},body:JSON.stringify(template)});
  if (!res.ok) throw new Error('PDF validation unavailable');
  return res.json();
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

export async function health(): Promise<boolean> { return (await bridgeHealth()).ok; }

export function getClient() { return { generate, validate, health }; }
