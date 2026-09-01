import type {
  AppHandoff,
  HandoffBroadcastMessage,
} from '@sorye/types';
import { HANDOFF_BROADCAST_CHANNEL } from '@sorye/types';
import { emitWorkspaceEvent } from './emit-event';
import {
  buildPdfTemplateFromLayouts,
  type OcrPdfTemplate,
} from './to-pdf-template';
import type { OcrPageLayout } from '@sorye/types';

export interface SendToProtocolioInput {
  layouts: OcrPageLayout[];
  fileName?: string;
  title?: string;
  pageCount?: number;
  cellCount?: number;
  rowCount?: number;
}

export interface SendToProtocolioResult {
  handoff: AppHandoff;
  template: OcrPdfTemplate;
  eventDelivered: boolean;
  pdf?: {
    blob: Blob;
    filename: string;
    generationTimeMs: number;
  };
}

function broadcastHandoff(handoff: AppHandoff): void {
  try {
    const channel = new BroadcastChannel(HANDOFF_BROADCAST_CHANNEL);
    const message: HandoffBroadcastMessage = {
      type: 'handoff-created',
      handoffId: handoff.id,
      targetAppId: handoff.targetAppId,
      sourceAppId: handoff.sourceAppId,
      kind: handoff.kind,
    };
    channel.postMessage(message);
    channel.close();
  } catch {
    // BroadcastChannel unavailable — Protocolio can still poll/fetch by id.
  }
}

async function generatePdfViaHubBridge(
  template: OcrPdfTemplate,
): Promise<{ blob: Blob; filename: string; generationTimeMs: number }> {
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
    throw new Error(
      [body.error, body.hint].filter(Boolean).join(' — ') ||
        `PDF generation failed (${res.status})`,
    );
  }

  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);

  return {
    blob,
    filename: filenameMatch?.[1] ?? 'ocr-document.pdf',
    generationTimeMs: parseInt(
      res.headers.get('x-generation-time-ms') ?? '0',
      10,
    ),
  };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function sendLayoutToProtocolio(
  input: SendToProtocolioInput,
): Promise<SendToProtocolioResult> {
  const template = buildPdfTemplateFromLayouts({
    layouts: input.layouts,
    fileName: input.fileName,
    title: input.title,
  });

  const title = template.metadata?.title ?? 'OCR Document';
  const summary = [
    input.pageCount != null ? `${input.pageCount} page(s)` : null,
    input.rowCount != null ? `${input.rowCount} rows` : null,
    input.cellCount != null ? `${input.cellCount} cells` : null,
    'Ready for Protocolio PDF',
  ]
    .filter(Boolean)
    .join(' · ');

  const res = await fetch('/api/handoffs', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceAppId: 'ocr',
      targetAppId: 'protocolio',
      kind: 'pdf-template',
      title,
      summary,
      payload: template,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof err?.error === 'string'
        ? err.error
        : 'Could not create Protocolio handoff',
    );
  }

  const data = (await res.json()) as { handoff: AppHandoff };
  const handoff = data.handoff;

  const event = await emitWorkspaceEvent('sorye.ocr.ready', {
    title,
    summary,
    appId: 'ocr',
    entityId: handoff.id,
    meta: {
      targetAppId: 'protocolio',
      kind: 'pdf-template',
      pages: input.pageCount ?? null,
      rows: input.rowCount ?? null,
      cells: input.cellCount ?? null,
    },
  });

  broadcastHandoff(handoff);

  // Developer bridge: Hub holds the Protocolio Bearer token and returns the PDF.
  const pdf = await generatePdfViaHubBridge(template);
  downloadBlob(pdf.blob, pdf.filename);

  return {
    handoff,
    template,
    eventDelivered: Boolean(event?.delivered),
    pdf,
  };
}
